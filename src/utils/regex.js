/**
 * Regex Patterns - All pattern matching for the bot
 */

// Bet pattern: matches "10v10", "10vs10", "15.5 vs 15.5", "$10 v $10"
const BET_PATTERN = /\$?(\d+(?:\.\d{1,2})?)\s*(?:v|vs)\s*\$?(\d+(?:\.\d{1,2})?)/i;

// Crypto address patterns
const CRYPTO_PATTERNS = {
    // Litecoin: L, M, or 3 prefix (Legacy), or ltc1 (Bech32)
    LTC: /^(L|M|3)[a-km-zA-HJ-NP-Z1-9]{26,33}$|^ltc1[a-z0-9]{39,59}$/,

    // Solana: Base58, 32-44 characters
    SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,

    // Bitcoin: 1 or 3 prefix (Legacy), or bc1 (Bech32)
    BTC: /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/
};

// Pattern to detect middleman starting the game
// e.g., "@User1 first, @User2 second" or "User1 goes first"
const GAME_START_PATTERN = /<@!?(\d+)>\s*(?:goes?\s*)?first|first:?\s*<@!?(\d+)>/i;

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
    /paid/i
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
        // Remove formatting and common punctuation
        const cleaned = word.replace(/[<>.,;:"'!?]/g, '');
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

    const userId = match[1] || match[2];
    return userId ? { userId } : null;
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
    isPaymentConfirmation
};
