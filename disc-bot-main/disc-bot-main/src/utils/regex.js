/**
 * Regex Patterns - All pattern matching for the bot
 */

const config = require('../../config.json');

// Bet pattern: matches "10v10", "10vs10", "15.5 vs 15.5", "$10 v $10"
// Refined to require at least one side to have a digit and boundary checks
const BET_PATTERN = /\b\$?(\d+(?:\.\d{1,2})?)\s*(?:v|vs)\s*\$?(\d+(?:\.\d{1,2})?)\b/i;

// Crypto address patterns
const CRYPTO_PATTERNS = {
    // Litecoin: L, M, or 3 prefix (Legacy), or ltc1 (Bech32)
    LTC: /^(L|M|3)[a-km-zA-HJ-NP-Z1-9]{26,33}$|^ltc1[a-z0-9]{35,60}$/i,

    // Solana: Base58, 32-44 characters
    SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,

    // Bitcoin: 1 or 3 prefix (Legacy), or bc1 (Bech32)
    BTC: /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{35,60}$/i
};

// Pattern to detect middleman starting the game
// e.g., "@User1 first, @User2 second" or "User1 goes first"
// Pattern to detect middleman starting the game
// e.g., "@User1 first, @User2 second" or "User1 goes first" or "ft5 @bot first" or "you first"
const GAME_START_PATTERN = /(?:ft\d+|game|dice|start|ready|gl|Confirm).*?(?:<@!?(\d+)>|(\b\w+\b)).*?first/i;

// Pattern to detect dice roll results from dice bots
// Matches common formats like "rolled a 6", "🎲 6", "[6]"
const DICE_RESULT_PATTERN = /(?:rolled?\s*(?:a\s*)?|🎲\s*|\[\s*)([1-6])(?:\s*\])?/i;

// Pattern to detect round/game announcements
const ROUND_PATTERN = /round\s*(\d+)|game\s*(\d+)|ft\s*(\d+)/i;

// Pattern for payment confirmation keywords
const PAYMENT_CONFIRM_PATTERNS = [
    /confirmed?/i,
    /received?/i,
    /got\s*(?:it|payment)/i,
    /paid/i,
    /both\s*(?:paid|sent|received)/i,  // "both paid", "both sent"
    /payments?\s*(?:confirmed|received)/i,  // "payment confirmed"
    /gl\b/i,  // "gl" (good luck - often said after confirmation)
    /good\s*luck/i,  // "good luck"
    /start\s*(?:the\s*)?game/i,  // "start the game"
    /ready\s*to\s*(?:go|start|play)/i  // "ready to go"
];

/**
 * Extract bet amounts from a message
 * @param {string} message - Message to parse
 * @returns {{ opponent: number, calculated: number } | null}
 */
function extractBetAmounts(message) {
    const match = message.match(BET_PATTERN);
    if (!match) return null;

    const amount1 = parseFloat(match[1]);
    const amount2 = parseFloat(match[2]);

    // For XvX format, both amounts should be equal
    // We take the first amount as the opponent's bet
    return {
        opponent: amount1,
        // We'll calculate our bet with tax elsewhere
        raw: { amount1, amount2 }
    };
}

/**
 * Validate a cryptocurrency address
 * @param {string} address - Address to validate
 * @param {string} network - 'LTC', 'SOL', or 'BTC'
 * @returns {boolean}
 */
function isValidCryptoAddress(address, network) {
    const pattern = CRYPTO_PATTERNS[network.toUpperCase()];
    if (!pattern) return false;
    return pattern.test(address.trim());
}

/**
 * Extract crypto address from message
 * @param {string} message - Message to parse
 * @param {string} network - 'LTC', 'SOL', or 'BTC'
 * @returns {string | null}
 */
function extractCryptoAddress(message, network) {
    const pattern = CRYPTO_PATTERNS[network.toUpperCase()];
    if (!pattern) return null;

    // Split message into words and find matching address
    const words = message.split(/\s+/);
    for (const word of words) {
        // Remove formatting, backticks, and common punctuation
        const cleaned = word.replace(/[`<>.,;:"'!?()[\]{}]/g, '');
        if (pattern.test(cleaned)) {
            return cleaned;
        }
    }
    return null;
}

/**
 * Check if message indicates game start and extract first player
 * @param {string} message - Message to parse
 * @returns {{ userId: string } | null}
 */
function extractGameStart(message) {
    const match = message.match(GAME_START_PATTERN);
    if (!match) return null;

    // Extract userId and username from the match
    const userId = match[1]; // This captures the ID from <@!ID>
    const username = match[2]; // This captures the word if no mention

    // Check if the bot was mentioned anywhere in a "first" context
    const botId = process.env.CLIENT_ID || '';
    const botMention = (botId && (message.includes(`<@${botId}>`) || message.includes(`<@!${botId}>`))) ||
        message.toLowerCase().includes('bot first') ||
        message.toLowerCase().includes('you first');

    const firstIsBot = (userId === botId) || botMention;

    return {
        userId: userId || null,
        username: username || null,
        botFirst: firstIsBot
    };
}

/**
 * Extract dice result from message
 * @param {string} message - Message to parse
 * @returns {number | null}
 */
function extractDiceResult(message) {
    const match = message.match(DICE_RESULT_PATTERN);
    if (!match) return null;
    return parseInt(match[1], 10);
}

/**
 * Check if message confirms payment
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isPaymentConfirmation(message) {
    return PAYMENT_CONFIRM_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Check if message contains cancellation keywords
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isCancellation(message) {
    const keywords = config.cancellation_keywords || ['void', 'cancel', 'refund', 'reset'];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
}

module.exports = {
    BET_PATTERN,
    CRYPTO_PATTERNS,
    GAME_START_PATTERN,
    DICE_RESULT_PATTERN,
    extractBetAmounts,
    isValidCryptoAddress,
    extractCryptoAddress,
    extractGameStart,
    extractDiceResult,
    isPaymentConfirmation,
    isCancellation
};
