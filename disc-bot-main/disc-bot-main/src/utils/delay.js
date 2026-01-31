/**
 * Delay Utility - Human-like typing simulation
 * Provides random delays to mimic human behavior and avoid detection
 */

const config = require('../../config.json');

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get a random delay within configured range
 * @param {number} min - Minimum delay in ms (default from config)
 * @param {number} max - Maximum delay in ms (default from config)
 * @returns {number}
 */
function getRandomDelay(min = config.delays.typing_min_ms, max = config.delays.typing_max_ms) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate typing delay based on message length
 * Simulates realistic typing speed
 * @param {string} message - Message to "type"
 * @returns {number} - Delay in milliseconds
 */
function getTypingDelay(message) {
    const baseDelay = config.delays.response_base_ms;
    const perCharDelay = config.delays.response_per_char_ms;
    const messageLength = message.length;

    // Add some randomness (±20%)
    const calculatedDelay = baseDelay + (messageLength * perCharDelay);
    const variance = calculatedDelay * 0.2;
    const randomVariance = (Math.random() * variance * 2) - variance;

    return Math.floor(calculatedDelay + randomVariance);
}

/**
 * Human-like delay before responding
 * Combines random delay with typing simulation
 * @param {string} message - Message that will be sent
 * @returns {Promise<void>}
 */
async function humanDelay(message = '') {
    // Configurable response delay
    const min = config.delays?.typing_min_ms || 2000;
    const max = config.delays?.typing_max_ms || 2500;

    const thinkDelay = getRandomDelay(min, max);
    await sleep(thinkDelay);

    // Typing delay based on message length
    if (message) {
        const typingDelay = getTypingDelay(message);
        await sleep(typingDelay);
    }
}

/**
 * Performance-optimized delay for financial transactions (faster payout)
 * @returns {Promise<void>}
 */
async function fastDelay() {
    // Shorter delay for payments (800ms - 1200ms)
    const delay = getRandomDelay(800, 1200);
    await sleep(delay);
}

/**
 * Random short delay for quick actions
 * @returns {Promise<void>}
 */
async function quickDelay() {
    const delay = getRandomDelay(200, 500);
    await sleep(delay);
}

/**
 * Delay between game actions (dice rolls)
 * @returns {Promise<void>}
 */
async function gameActionDelay() {
    // Safe game action delay (1.0-1.5 seconds)
    const delay = getRandomDelay(1000, 1500);
    await sleep(delay);
}

/**
 * Delay for bet snipe responses (more human-like)
 * @returns {Promise<void>}
 */
async function snipeDelay() {
    // Fixed 2-second delay for snipe responses (human-like reaction time)
    const delay = config.delays?.snipe_response_ms || 2000;
    await sleep(delay);
}

module.exports = {
    sleep,
    getRandomDelay,
    getTypingDelay,
    humanDelay,
    fastDelay,
    quickDelay,
    gameActionDelay,
    snipeDelay
};
