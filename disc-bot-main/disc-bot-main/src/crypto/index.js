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
 * @returns {Promise<{success: boolean, txId?: string, error?: string}>}
 */
async function sendPayment(toAddress, amount) {
    try {
        // SAFETY GATE 1: Check if simulation mode is enabled in config
        if (config.simulation_mode) {
            logger.warn('⚠️ SIMULATION MODE: Fake payment sent', { to: toAddress, amount });
            return {
                success: true,
                txId: 'simulated_tx_' + crypto.randomBytes(8).toString('hex')
            };
        }

        // SAFETY GATE 2: Require explicit ENABLE_LIVE_TRANSFERS=true in .env
        const liveTransfersEnabled = process.env.ENABLE_LIVE_TRANSFERS === 'true';
        if (!liveTransfersEnabled) {
            logger.warn('⚠️ DRY-RUN MODE: Set ENABLE_LIVE_TRANSFERS=true in .env to send real money');
            logger.info('Would have sent payment', { to: toAddress, amount, network: config.crypto_network });
            return {
                success: true,
                txId: 'dryrun_tx_' + crypto.randomBytes(8).toString('hex'),
                dryRun: true
            };
        }

        // SAFETY GATE 3: Spending limit check
        const maxPaymentPerTx = parseFloat(process.env.MAX_PAYMENT_PER_TX) || 50; // Default $50 limit
        if (amount > maxPaymentPerTx) {
            logger.error('Payment exceeds per-transaction limit', {
                amount,
                limit: maxPaymentPerTx
            });
            return {
                success: false,
                error: `Payment $${amount} exceeds limit of $${maxPaymentPerTx}`
            };
        }

        const handler = getCurrentHandler();
        logger.info('💸 SENDING REAL PAYMENT', { network: config.crypto_network, to: toAddress, amount });

        const result = await handler.sendPayment(toAddress, amount);

        if (result.success) {
            logger.info('✅ Payment sent successfully', { txId: result.txId });
        } else {
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
