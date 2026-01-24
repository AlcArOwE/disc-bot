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
    return config.payout_addresses[network.toUpperCase()];
}

/**
 * Send payment using configured network
 * @param {string} toAddress - Recipient address
 * @param {number} amount - Amount in crypto (not USD)
 * @returns {Promise<{success: boolean, txId?: string, error?: string}>}
 */
async function sendPayment(toAddress, amount) {
    try {
        if (config.simulation_mode) {
            logger.warn('⚠️ SIMULATION MODE: Fake payment sent', { to: toAddress, amount });
            return {
                success: true,
                txId: 'simulated_tx_' + crypto.randomBytes(8).toString('hex')
            };
        }

        const handler = getCurrentHandler();
        logger.info('Sending payment', { network: config.crypto_network, to: toAddress, amount });

        const result = await handler.sendPayment(toAddress, amount);

        if (result.success) {
            logger.info('Payment sent successfully', { txId: result.txId });
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
