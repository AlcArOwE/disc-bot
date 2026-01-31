/**
 * Error Handling Utilities
 * Phase 7: Centralized error handling, recovery, and logging
 */

const { logger } = require('./logger');

// Error categories
const ErrorCategory = {
    PAYMENT: 'PAYMENT',         // Payment-related errors
    STATE: 'STATE',             // State machine errors
    NETWORK: 'NETWORK',         // Network/API errors
    VALIDATION: 'VALIDATION',   // Input validation errors
    PERMISSION: 'PERMISSION',   // Authorization errors
    DISCORD: 'DISCORD',         // Discord API errors
    CRYPTO: 'CRYPTO',           // Crypto handler errors
    UNKNOWN: 'UNKNOWN'          // Uncategorized errors
};

// Error severity levels
const Severity = {
    LOW: 'LOW',           // Recoverable, minor
    MEDIUM: 'MEDIUM',     // Should be investigated
    HIGH: 'HIGH',         // Critical, needs immediate attention
    CRITICAL: 'CRITICAL'  // System-wide failure
};

// Error metrics
const errorMetrics = {
    total: 0,
    byCategory: {},
    bySeverity: {},
    recentErrors: [] // Last 100 errors
};

// Rate limiting for error logging
const errorRateLimit = new Map(); // category -> {count, lastReset}
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // Max errors per category per window

/**
 * Categorize an error based on its message and type
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
function categorizeError(error) {
    const message = error.message?.toLowerCase() || '';

    if (message.includes('payment') || message.includes('transaction') || message.includes('balance')) {
        return ErrorCategory.PAYMENT;
    }
    if (message.includes('state') || message.includes('transition')) {
        return ErrorCategory.STATE;
    }
    if (message.includes('network') || message.includes('timeout') || message.includes('econnrefused')) {
        return ErrorCategory.NETWORK;
    }
    if (message.includes('validation') || message.includes('invalid')) {
        return ErrorCategory.VALIDATION;
    }
    if (message.includes('permission') || message.includes('unauthorized')) {
        return ErrorCategory.PERMISSION;
    }
    if (message.includes('discord') || message.includes('channel') || message.includes('message')) {
        return ErrorCategory.DISCORD;
    }
    if (message.includes('crypto') || message.includes('wallet') || message.includes('address')) {
        return ErrorCategory.CRYPTO;
    }

    return ErrorCategory.UNKNOWN;
}

/**
 * Determine error severity
 * @param {Error} error - The error
 * @param {string} category - Error category
 * @returns {string} Severity level
 */
function determineSeverity(error, category) {
    // Payment errors are always high severity
    if (category === ErrorCategory.PAYMENT) {
        return Severity.HIGH;
    }

    // State corruption is critical
    if (error.message?.includes('corruption') || error.message?.includes('deadlock')) {
        return Severity.CRITICAL;
    }

    // Network errors are medium (often transient)
    if (category === ErrorCategory.NETWORK) {
        return Severity.MEDIUM;
    }

    // Validation errors are low (user input)
    if (category === ErrorCategory.VALIDATION) {
        return Severity.LOW;
    }

    return Severity.MEDIUM;
}

/**
 * Check if error should be rate limited
 * @param {string} category - Error category
 * @returns {boolean}
 */
function isRateLimited(category) {
    const now = Date.now();
    const rateInfo = errorRateLimit.get(category);

    if (!rateInfo || now - rateInfo.lastReset > RATE_LIMIT_WINDOW) {
        errorRateLimit.set(category, { count: 1, lastReset: now });
        return false;
    }

    if (rateInfo.count >= RATE_LIMIT_MAX) {
        return true;
    }

    rateInfo.count++;
    return false;
}

/**
 * Handle an error with full context and recovery
 * @param {Error} error - The error
 * @param {Object} context - Additional context
 * @returns {{handled: boolean, recovery: string|null}}
 */
function handleError(error, context = {}) {
    const category = categorizeError(error);
    const severity = determineSeverity(error, category);

    // Update metrics
    errorMetrics.total++;
    errorMetrics.byCategory[category] = (errorMetrics.byCategory[category] || 0) + 1;
    errorMetrics.bySeverity[severity] = (errorMetrics.bySeverity[severity] || 0) + 1;

    // Store recent error
    errorMetrics.recentErrors.push({
        timestamp: Date.now(),
        category,
        severity,
        message: error.message,
        context
    });
    if (errorMetrics.recentErrors.length > 100) {
        errorMetrics.recentErrors.shift();
    }

    // Rate limit check
    const rateLimited = isRateLimited(category);

    // Log based on severity (unless rate limited)
    if (!rateLimited) {
        const logData = {
            category,
            severity,
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            ...context
        };

        switch (severity) {
            case Severity.CRITICAL:
                logger.error('🚨 CRITICAL ERROR', logData);
                break;
            case Severity.HIGH:
                logger.error('❌ HIGH SEVERITY ERROR', logData);
                break;
            case Severity.MEDIUM:
                logger.warn('⚠️ ERROR', logData);
                break;
            default:
                logger.info('ℹ️ Minor error', logData);
        }
    }

    // Determine recovery action
    let recovery = null;
    if (category === ErrorCategory.NETWORK) {
        recovery = 'RETRY';
    } else if (category === ErrorCategory.STATE) {
        recovery = 'ROLLBACK';
    } else if (category === ErrorCategory.PAYMENT) {
        recovery = 'HALT';
    }

    return { handled: true, recovery, category, severity };
}

/**
 * Get error metrics summary
 * @returns {Object}
 */
function getErrorMetrics() {
    return {
        ...errorMetrics,
        recentCount: errorMetrics.recentErrors.length
    };
}

/**
 * Clear error metrics (for testing)
 */
function clearErrorMetrics() {
    errorMetrics.total = 0;
    errorMetrics.byCategory = {};
    errorMetrics.bySeverity = {};
    errorMetrics.recentErrors = [];
}

module.exports = {
    ErrorCategory,
    Severity,
    categorizeError,
    determineSeverity,
    handleError,
    getErrorMetrics,
    clearErrorMetrics,
    isRateLimited
};
