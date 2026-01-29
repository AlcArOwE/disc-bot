/**
 * Validator Utility - Input validation and sanitization
 */

const { isValidCryptoAddress } = require('./regex');
const config = require('../../config.json');

/**
 * Validate bet amount is within configured limits
 * @param {number} amount - Amount to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateBetAmount(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
        return { valid: false, reason: 'Invalid number' };
    }

    if (amount < config.betting_limits.min) {
        return { valid: false, reason: `Below minimum ($${config.betting_limits.min})` };
    }

    if (amount > config.betting_limits.max) {
        return { valid: false, reason: `Above maximum ($${config.betting_limits.max})` };
    }

    return { valid: true };
}

/**
 * Check if user ID is a configured middleman
 * @param {string} userId - Discord user ID
 * @returns {boolean}
 */
function isMiddleman(userId) {
    return config.middleman_ids.includes(userId);
}

/**
 * Validate crypto address before sending payment
 * @param {string} address - Crypto address
 * @param {string} network - Network type (LTC, SOL, BTC)
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePaymentAddress(address, network = config.crypto_network) {
    if (!address || typeof address !== 'string') {
        return { valid: false, reason: 'Empty or invalid address' };
    }

    const trimmed = address.trim();

    if (!isValidCryptoAddress(trimmed, network)) {
        return { valid: false, reason: `Invalid ${network} address format` };
    }

    // Check it's not our own payout address (prevent self-send)
    const ourAddress = config.payout_addresses[network];
    if (trimmed === ourAddress) {
        return { valid: false, reason: 'Cannot send to own payout address' };
    }

    return { valid: true };
}

/**
 * Sanitize user input for logging
 * @param {string} input - Raw input
 * @returns {string}
 */
function sanitizeForLog(input) {
    if (typeof input !== 'string') return String(input);
    // Remove sensitive patterns, limit length
    return input
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable
        .substring(0, 500); // Limit length
}

/**
 * Validate Discord channel ID format
 * @param {string} channelId - Channel ID to validate
 * @returns {boolean}
 */
function isValidChannelId(channelId) {
    return /^\d{17,19}$/.test(channelId);
}

/**
 * Validate Discord user ID format
 * @param {string} userId - User ID to validate
 * @returns {boolean}
 */
function isValidUserId(userId) {
    return /^\d{17,19}$/.test(userId);
}

module.exports = {
    validateBetAmount,
    isMiddleman,
    validatePaymentAddress,
    sanitizeForLog,
    isValidChannelId,
    isValidUserId
};
