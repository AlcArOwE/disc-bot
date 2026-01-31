/**
 * Payment Validator
 * Phase 4: Additional safety checks before any payment is sent
 */

const config = require('../../config.json');
const { logger } = require('./logger');
const { classifyChannel, ChannelType } = require('./channelClassifier');

// Channel IDs that are NEVER allowed for payments
const PAYMENT_BLOCKLIST = config.payment_safety?.public_channel_blocklist || [];

// Minimum amount for any payment (prevent dust attacks)
const MIN_PAYMENT_USD = 0.10;

// Maximum amount for any single payment
const MAX_PAYMENT_USD = config.payment_safety?.max_payment_per_tx || 50;

// Timer to prevent rapid-fire payments (ms)
const PAYMENT_COOLDOWN_MS = 5000;
const recentPayments = new Map(); // channelId -> timestamp

/**
 * Validate a channel is authorized for payments
 * @param {Object} channel - Discord channel object
 * @returns {{valid: boolean, reason: string}}
 */
function validatePaymentChannel(channel) {
    if (!channel) {
        return { valid: false, reason: 'No channel provided' };
    }

    // Check blocklist
    if (PAYMENT_BLOCKLIST.includes(channel.id)) {
        logger.error('🚫 PAYMENT BLOCKED: Channel in blocklist', { channelId: channel.id });
        return { valid: false, reason: 'Channel is blocklisted' };
    }

    // Use channel classifier
    const classification = classifyChannel(channel);

    if (!classification.allowPayment) {
        logger.error('🚫 PAYMENT BLOCKED: Channel type not allowed', {
            channelId: channel.id,
            channelType: classification.type,
            reason: classification.reason
        });
        return { valid: false, reason: `Channel type ${classification.type} not allowed for payments` };
    }

    return { valid: true, reason: 'Channel authorized' };
}

/**
 * Validate a payment amount
 * @param {number} amountUsd - Payment amount in USD
 * @returns {{valid: boolean, reason: string}}
 */
function validatePaymentAmount(amountUsd) {
    if (typeof amountUsd !== 'number' || isNaN(amountUsd)) {
        return { valid: false, reason: 'Amount is not a valid number' };
    }

    if (!isFinite(amountUsd)) {
        return { valid: false, reason: 'Amount is infinite' };
    }

    if (amountUsd <= 0) {
        return { valid: false, reason: 'Amount must be positive' };
    }

    if (amountUsd < MIN_PAYMENT_USD) {
        return { valid: false, reason: `Amount $${amountUsd} below minimum $${MIN_PAYMENT_USD}` };
    }

    if (amountUsd > MAX_PAYMENT_USD) {
        return { valid: false, reason: `Amount $${amountUsd} exceeds maximum $${MAX_PAYMENT_USD}` };
    }

    return { valid: true, reason: 'Amount valid' };
}

/**
 * Validate a crypto address format
 * @param {string} address - Crypto address
 * @param {string} network - Network type (LTC, BTC, SOL)
 * @returns {{valid: boolean, reason: string}}
 */
function validateAddress(address, network = 'LTC') {
    if (!address || typeof address !== 'string') {
        return { valid: false, reason: 'Address is empty or not a string' };
    }

    const trimmed = address.trim();

    if (trimmed.length < 20) {
        return { valid: false, reason: 'Address too short' };
    }

    if (trimmed.length > 64) {
        return { valid: false, reason: 'Address too long' };
    }

    // Network-specific validation
    switch (network.toUpperCase()) {
        case 'LTC':
            if (!/^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(trimmed)) {
                return { valid: false, reason: 'Invalid LTC address format' };
            }
            break;
        case 'BTC':
            if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(trimmed)) {
                return { valid: false, reason: 'Invalid BTC address format' };
            }
            break;
        case 'SOL':
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
                return { valid: false, reason: 'Invalid SOL address format' };
            }
            break;
    }

    return { valid: true, reason: 'Address valid' };
}

/**
 * Check if payment cooldown is active
 * @param {string} channelId - Channel ID
 * @returns {{onCooldown: boolean, remainingMs: number}}
 */
function checkPaymentCooldown(channelId) {
    const lastPayment = recentPayments.get(channelId);
    if (!lastPayment) {
        return { onCooldown: false, remainingMs: 0 };
    }

    const elapsed = Date.now() - lastPayment;
    if (elapsed < PAYMENT_COOLDOWN_MS) {
        return {
            onCooldown: true,
            remainingMs: PAYMENT_COOLDOWN_MS - elapsed
        };
    }

    return { onCooldown: false, remainingMs: 0 };
}

/**
 * Record a payment for cooldown tracking
 * @param {string} channelId - Channel ID
 */
function recordPaymentAttempt(channelId) {
    recentPayments.set(channelId, Date.now());

    // Cleanup old entries (older than 1 minute)
    const cutoff = Date.now() - 60000;
    for (const [id, timestamp] of recentPayments) {
        if (timestamp < cutoff) {
            recentPayments.delete(id);
        }
    }
}

/**
 * Full payment pre-flight validation
 * @param {Object} params - Payment parameters
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePayment(params) {
    const { channel, address, amountUsd, network } = params;
    const errors = [];

    // Check emergency stop
    if (process.env.EMERGENCY_STOP === 'true') {
        errors.push('EMERGENCY_STOP is enabled');
    }

    // Validate channel
    const channelCheck = validatePaymentChannel(channel);
    if (!channelCheck.valid) {
        errors.push(channelCheck.reason);
    }

    // Validate amount
    const amountCheck = validatePaymentAmount(amountUsd);
    if (!amountCheck.valid) {
        errors.push(amountCheck.reason);
    }

    // Validate address
    const addressCheck = validateAddress(address, network);
    if (!addressCheck.valid) {
        errors.push(addressCheck.reason);
    }

    // Check cooldown
    if (channel?.id) {
        const cooldownCheck = checkPaymentCooldown(channel.id);
        if (cooldownCheck.onCooldown) {
            errors.push(`Payment cooldown active (${cooldownCheck.remainingMs}ms remaining)`);
        }
    }

    if (errors.length > 0) {
        logger.error('🚫 PAYMENT VALIDATION FAILED', { errors, params: { channelId: channel?.id, amountUsd, network } });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    validatePaymentChannel,
    validatePaymentAmount,
    validateAddress,
    validatePayment,
    checkPaymentCooldown,
    recordPaymentAttempt,
    PAYMENT_BLOCKLIST,
    MIN_PAYMENT_USD,
    MAX_PAYMENT_USD
};
