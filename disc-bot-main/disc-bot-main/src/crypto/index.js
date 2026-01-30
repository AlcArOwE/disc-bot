const crypto = require('crypto');
const config = require('../../config.json');
const { logger } = require('../utils/logger');

let LitecoinHandler, SolanaHandler, BitcoinHandler;

// Lazy load handlers to avoid requiring all libraries
function getHandler(network = config.crypto_network) {
    const net = network.toUpperCase();

    switch (net) {
        case 'LTC':
            if (!LitecoinHandler) LitecoinHandler = require('./LitecoinHandler');
            return new LitecoinHandler();
        case 'SOL':
            if (!SolanaHandler) SolanaHandler = require('./SolanaHandler');
            return new SolanaHandler();
        case 'BTC':
            if (!BitcoinHandler) BitcoinHandler = require('./BitcoinHandler');
            return new BitcoinHandler();
        default:
            throw new Error(`Unsupported network: ${net}`);
    }
}

/**
 * Get the current configured handler
 */
function getCurrentHandler() {
    return getHandler(config.crypto_network);
}

/**
 * Get payout address for network
 */
function getPayoutAddress(network = config.crypto_network) {
    const envKey = `${network.toUpperCase()}_PAYOUT_ADDRESS`;
    return process.env[envKey] || config.payout_addresses?.[network.toUpperCase()];
}

/**
 * Send payment using configured network
 * @param {string} toAddress - Recipient address
 * @param {number} amount - Amount in crypto (not USD)
 * @param {string} paymentId - Unique payment ID for idempotency (optional, auto-generated)
 * @param {string} ticketId - Ticket ID for tracking (optional)
 * @returns {Promise<{success: boolean, txId?: string, error?: string, duplicate?: boolean}>}
 */

// Import persistent idempotency store
const { idempotencyStore } = require('../state/IdempotencyStore');

async function sendPayment(toAddress, amountUsd, network = config.crypto_network, ticketId = null) {
    try {
        const paymentId = idempotencyStore.generatePaymentId(ticketId || 'unknown', toAddress, amountUsd);

        // SAFETY GATE 1: Check if simulation mode is enabled in config
        if (config.simulation_mode) {
            logger.warn('⚠️ SIMULATION MODE: Fake payment sent', { to: toAddress, amountUsd });
            return {
                success: true,
                txId: 'simulated_tx_' + crypto.randomBytes(8).toString('hex')
            };
        }

        // SAFETY GATE 2: Require explicit ENABLE_LIVE_TRANSFERS=true in .env
        const liveTransfersEnabled = process.env.ENABLE_LIVE_TRANSFERS === 'true';
        if (!liveTransfersEnabled) {
            logger.warn('⚠️ DRY-RUN MODE: Set ENABLE_LIVE_TRANSFERS=true in .env to send real money');
            logger.info('Would have sent payment', { to: toAddress, amountUsd, network: config.crypto_network });
            return {
                success: true,
                txId: 'dryrun_tx_' + crypto.randomBytes(8).toString('hex'),
                dryRun: true
            };
        }

        // SAFETY GATE 3: PERSISTENT Idempotency check
        const idempotencyCheck = idempotencyStore.canSend(paymentId);
        if (!idempotencyCheck.canSend) {
            logger.warn('⚠️ IDEMPOTENCY: Payment blocked', {
                paymentId,
                reason: idempotencyCheck.reason,
                existingTxId: idempotencyCheck.existingTxId
            });
            return {
                success: true,
                txId: idempotencyCheck.existingTxId,
                duplicate: true
            };
        }

        // SAFETY GATE 4: Address allowlist (if configured)
        const allowlist = config.payment_safety?.address_allowlist || [];
        if (allowlist.length > 0 && !allowlist.includes(toAddress)) {
            logger.error('❌ ADDRESS NOT IN ALLOWLIST', { toAddress, allowlist });
            return {
                success: false,
                error: 'Address not in allowed list'
            };
        }

        // SAFETY GATE 5: Per-transaction limit
        const maxPerTx = config.payment_safety?.max_payment_per_tx ||
            parseFloat(process.env.MAX_PAYMENT_PER_TX) || 50;
        if (amountUsd > maxPerTx) {
            logger.error('Payment exceeds per-transaction limit', { amountUsd, limit: maxPerTx });
            return {
                success: false,
                error: `Payment $${amountUsd} exceeds limit of $${maxPerTx}`
            };
        }

        // SAFETY GATE 6: Daily limit (using persistent store)
        const maxDaily = config.payment_safety?.max_daily_usd || 500;
        const dailySpend = idempotencyStore.getDailySpend();
        if (dailySpend + amountUsd > maxDaily) {
            logger.error('Payment would exceed daily limit', {
                amountUsd,
                dailySpent: dailySpend,
                limit: maxDaily
            });
            return {
                success: false,
                error: `Daily limit of $${maxDaily} would be exceeded`
            };
        }

        // Record INTENT before broadcast (for crash recovery)
        if (!idempotencyStore.recordIntent(paymentId, toAddress, amountUsd, ticketId)) {
            // Intent already exists but canSend returned true (must be PENDING or FAILED)
            logger.info('Retrying existing payment', { paymentId });
        }

        const handler = getHandler(network);
        const { priceOracle } = require('./PriceOracle');
        logger.info(`🧮 Converting $${amountUsd} to ${network.toUpperCase()}...`);

        let cryptoAmount;
        try {
            cryptoAmount = await priceOracle.convertUsdToCrypto(amountUsd, network);
            const currentPrice = await priceOracle.getPrice(network);
            logger.info(`✨ Conversion: $${amountUsd} USD = ${cryptoAmount} ${network.toUpperCase()} (Price: $${currentPrice})`);
        } catch (priceError) {
            logger.error('❌ Price conversion failed - aborting payment', { error: priceError.message });
            return {
                success: false,
                error: `Could not determine ${network} price: ${priceError.message}. Payment aborted for safety.`
            };
        }

        // SAFETY GATE 7: Balance Check
        try {
            const { balance } = await handler.getBalance();
            if (balance < cryptoAmount) {
                logger.error('❌ INSUFFICIENT BALANCE', {
                    network,
                    available: balance,
                    required: cryptoAmount
                });
                return {
                    success: false,
                    error: `Insufficient ${network} balance. Have ${balance.toFixed(4)}, need ${cryptoAmount.toFixed(4)}.`
                };
            }
            logger.info(`💰 Balance verified: ${balance} ${network} available`);
        } catch (balanceError) {
            logger.warn('⚠️ Could not verify balance, proceeding with caution', { error: balanceError.message });
        }

        logger.info('💸 SENDING REAL PAYMENT', {
            network: network.toUpperCase(),
            to: toAddress,
            usdAmount: amountUsd,
            cryptoAmount: cryptoAmount,
            paymentId
        });

        let result;
        try {
            // PASS THE CONVERTED CRYPTO AMOUNT TO THE HANDLER
            result = await handler.sendPayment(toAddress, cryptoAmount);
        } catch (broadcastError) {
            // Record failure
            idempotencyStore.recordFailed(paymentId, broadcastError.message);
            throw broadcastError;
        }

        if (result.success) {
            // Record BROADCAST immediately after success
            idempotencyStore.recordBroadcast(paymentId, result.txId);
            // Mark as CONFIRMED (in real implementation, wait for blockchain confirmation)
            idempotencyStore.recordConfirmed(paymentId);

            logger.info('✅ Payment sent successfully', {
                txId: result.txId,
                paymentId,
                dailySpendAfter: idempotencyStore.getDailySpend()
            });
        } else {
            idempotencyStore.recordFailed(paymentId, result.error);
            logger.error('Payment failed', { error: result.error });
        }

        return result;
    } catch (error) {
        logger.error('Payment error', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Validate address for configured network
 * @param {string} address - Address to validate
 * @returns {boolean}
 */
function validateAddress(address) {
    try {
        const handler = getCurrentHandler();
        return handler.validateAddress(address);
    } catch (error) {
        return false;
    }
}

/**
 * Get wallet balance
 * @returns {Promise<{balance: number, error?: string}>}
 */
async function getBalance() {
    try {
        const handler = getCurrentHandler();
        return await handler.getBalance();
    } catch (error) {
        return { balance: 0, error: error.message };
    }
}

module.exports = {
    getHandler,
    getCurrentHandler,
    getPayoutAddress,
    sendPayment,
    validateAddress,
    getBalance
};
