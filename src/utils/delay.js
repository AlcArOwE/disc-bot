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
 * Enforced strict 2.0s - 2.5s range for safety
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number}
 */
function getRandomDelay(min = 2000, max = 2500) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate typing delay based on message length
 * @deprecated Use strict 2.0-2.5s delay instead
 * @param {string} message - Message to "type"
 * @returns {number} - Delay in milliseconds
 */
function getTypingDelay(message) {
    // Fallback to strict range even if called directly
    return getRandomDelay(2000, 2500);
}

/**
 * Human-like delay before responding
 * Strictly enforces 2.0s - 2.5s delay
 * @param {string} message - Message that will be sent (unused for timing now)
 * @returns {Promise<void>}
 */
async function humanDelay(message = '') {
    // Strict safety window: 2000ms - 2500ms
    const delay = getRandomDelay(2000, 2500);
    await sleep(delay);
}

/**
 * Random short delay for quick actions
 * Updated to safer limits
 * @returns {Promise<void>}
 */
async function quickDelay() {
    const delay = getRandomDelay(2000, 2500);
    await sleep(delay);
}

/**
 * Delay between game actions (dice rolls)
 * Updated to safer limits
 * @returns {Promise<void>}
 */
async function gameActionDelay() {
    const delay = getRandomDelay(2000, 2500);
    await sleep(delay);
}

module.exports = {
    sleep,
    getRandomDelay,
    getTypingDelay,
    humanDelay,
    quickDelay,
    gameActionDelay
};
