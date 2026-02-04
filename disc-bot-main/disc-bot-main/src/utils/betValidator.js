/**
 * Bet Validator
 * Phase 8: Additional bet validation and safety checks
 */

const BigNumber = require('bignumber.js');
const config = require('../../config.json');
const { logger } = require('./logger');

// Safety limits
const MAX_BET_USD = config.payment_safety?.global_max_bet_usd || 100;
const MIN_BET_USD = config.payment_safety?.min_bet_usd || 1;
const MAX_BONUS_RATE = 0.50; // 50% max bonus

// Cooldown tracking
const recentBets = new Map(); // userId -> {timestamp, count}
const BET_COOLDOWN_MS = config.bet_cooldown_ms || 2500;
const MAX_BETS_PER_MINUTE = 5;

/**
 * Validate a bet amount
 * @param {number} amount - Bet amount in USD
 * @returns {{valid: boolean, reason: string}}
 */
function validateBetAmount(amount) {
    // Type check
    if (typeof amount !== 'number' || isNaN(amount)) {
        return { valid: false, reason: 'Amount is not a valid number' };
    }

    if (!isFinite(amount)) {
        return { valid: false, reason: 'Amount is infinite' };
    }

    // Range check
    if (amount <= 0) {
        return { valid: false, reason: 'Amount must be positive' };
    }

    if (amount < MIN_BET_USD) {
        return { valid: false, reason: `Amount $${amount} below minimum $${MIN_BET_USD}` };
    }

    if (amount > MAX_BET_USD) {
        return { valid: false, reason: `Amount $${amount} exceeds maximum $${MAX_BET_USD}` };
    }

    // Precision check (max 2 decimal places)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
        return { valid: false, reason: 'Amount has too many decimal places' };
    }

    return { valid: true, reason: 'Valid bet amount' };
}

/**
 * Calculate the bonus bet amount
 * @param {number} opponentBet - Opponent's bet
 * @param {number} bonusRate - Bonus rate (default from config)
 * @returns {{ourBet: number, bonusAmount: number, valid: boolean}}
 */
function calculateBonusBet(opponentBet, bonusRate = config.bonus_percentage || 0.20) {
    // Validate bonus rate
    if (bonusRate < 0 || bonusRate > MAX_BONUS_RATE) {
        logger.warn('Invalid bonus rate', { bonusRate, max: MAX_BONUS_RATE });
        return { valid: false, ourBet: 0, bonusAmount: 0 };
    }

    const opponent = new BigNumber(opponentBet);
    const bonusAmount = opponent.times(bonusRate);
    const ourBet = opponent.plus(bonusAmount);

    return {
        valid: true,
        ourBet: parseFloat(ourBet.toFixed(2)),
        bonusAmount: parseFloat(bonusAmount.toFixed(2)),
        opponentBet: parseFloat(opponent.toFixed(2))
    };
}

/**
 * Check bet cooldown for user
 * @param {string} userId - Discord user ID
 * @returns {{onCooldown: boolean, remainingMs: number}}
 */
function checkBetCooldown(userId) {
    const now = Date.now();
    const userBets = recentBets.get(userId);

    if (!userBets) {
        return { onCooldown: false, remainingMs: 0 };
    }

    const elapsed = now - userBets.timestamp;
    if (elapsed < BET_COOLDOWN_MS) {
        return {
            onCooldown: true,
            remainingMs: BET_COOLDOWN_MS - elapsed
        };
    }

    return { onCooldown: false, remainingMs: 0 };
}

/**
 * Record a bet attempt for rate limiting
 * @param {string} userId - Discord user ID
 */
function recordBetAttempt(userId) {
    const now = Date.now();
    const userBets = recentBets.get(userId);

    if (!userBets || now - userBets.timestamp > 60000) {
        // Reset if older than 1 minute
        recentBets.set(userId, { timestamp: now, count: 1 });
    } else {
        userBets.timestamp = now;
        userBets.count++;
    }
}

/**
 * Check if user is rate limited on bets
 * @param {string} userId - Discord user ID
 * @returns {boolean}
 */
function isBetRateLimited(userId) {
    const userBets = recentBets.get(userId);
    if (!userBets) return false;

    const now = Date.now();
    if (now - userBets.timestamp > 60000) {
        return false;
    }

    return userBets.count >= MAX_BETS_PER_MINUTE;
}

/**
 * Full bet pre-flight validation
 * @param {Object} params - Bet parameters
 * @returns {{valid: boolean, errors: string[], betData: Object|null}}
 */
function validateBet(params) {
    const { userId, amount } = params;
    const errors = [];

    // Validate amount
    const amountCheck = validateBetAmount(amount);
    if (!amountCheck.valid) {
        errors.push(amountCheck.reason);
    }

    // Check cooldown
    const cooldownCheck = checkBetCooldown(userId);
    if (cooldownCheck.onCooldown) {
        errors.push(`Bet cooldown active (${cooldownCheck.remainingMs}ms remaining)`);
    }

    // Check rate limit
    if (isBetRateLimited(userId)) {
        errors.push(`Too many bets (${MAX_BETS_PER_MINUTE}/minute limit)`);
    }

    if (errors.length > 0) {
        return { valid: false, errors, betData: null };
    }

    // Calculate bonus bet
    const bonusData = calculateBonusBet(amount);
    if (!bonusData.valid) {
        errors.push('Failed to calculate bonus bet');
        return { valid: false, errors, betData: null };
    }

    return {
        valid: true,
        errors: [],
        betData: bonusData
    };
}

/**
 * Cleanup old bet records
 */
function cleanupBetRecords() {
    const now = Date.now();
    const cutoff = now - 120000; // 2 minutes

    for (const [userId, data] of recentBets) {
        if (data.timestamp < cutoff) {
            recentBets.delete(userId);
        }
    }
}

// Periodic cleanup
setInterval(cleanupBetRecords, 60000);

module.exports = {
    validateBetAmount,
    calculateBonusBet,
    checkBetCooldown,
    recordBetAttempt,
    isBetRateLimited,
    validateBet,
    cleanupBetRecords,
    MAX_BET_USD,
    MIN_BET_USD,
    MAX_BONUS_RATE
};
