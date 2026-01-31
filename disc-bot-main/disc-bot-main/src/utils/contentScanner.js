/**
 * Content Safety Scanner
 * Phase 2 Item #16: Scan message content for dangerous patterns before routing
 */

const config = require('../../config.json');
const { logger } = require('./logger');

// Patterns that indicate crypto addresses
const ADDRESS_PATTERNS = {
    LTC: /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/,
    BTC: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/,
    SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
};

// Keywords that might indicate payment requests
const PAYMENT_KEYWORDS = [
    'send to', 'pay to', 'transfer to', 'my address', 'wallet:',
    'payout:', 'withdraw to', 'send here', 'pay here'
];

/**
 * Check if message contains a crypto address
 * @param {string} content - Message content
 * @returns {{found: boolean, type: string|null, address: string|null}}
 */
function containsCryptoAddress(content) {
    if (!content) return { found: false, type: null, address: null };

    const words = content.split(/\s+/);

    for (const word of words) {
        for (const [type, pattern] of Object.entries(ADDRESS_PATTERNS)) {
            if (pattern.test(word)) {
                return { found: true, type, address: word };
            }
        }
    }

    return { found: false, type: null, address: null };
}

/**
 * Check if message contains payment keywords
 * @param {string} content - Message content
 * @returns {boolean}
 */
function containsPaymentKeywords(content) {
    if (!content) return false;
    const lower = content.toLowerCase();
    return PAYMENT_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Scan message for dangerous content that shouldn't be processed in public channels
 * @param {Object} message - Discord message
 * @param {Object} channelClass - Channel classification
 * @returns {{safe: boolean, warnings: string[]}}
 */
function scanMessageContent(message, channelClass) {
    const warnings = [];
    const content = message.content;

    // Check for crypto address
    const addressCheck = containsCryptoAddress(content);
    if (addressCheck.found) {
        // If we're NOT in a ticket channel, this is suspicious
        if (!channelClass.allowPayment) {
            warnings.push(`Contains ${addressCheck.type} address in non-ticket channel`);
            logger.warn('⚠️ CONTENT SCAN: Address detected in non-ticket channel', {
                channelId: message.channel.id,
                channelType: channelClass.type,
                addressType: addressCheck.type
            });
        }
    }

    // Check for payment keywords
    if (containsPaymentKeywords(content) && !channelClass.allowPayment) {
        warnings.push('Contains payment keywords in non-ticket channel');
    }

    return {
        safe: warnings.length === 0,
        warnings
    };
}

module.exports = {
    containsCryptoAddress,
    containsPaymentKeywords,
    scanMessageContent,
    ADDRESS_PATTERNS,
    PAYMENT_KEYWORDS
};
