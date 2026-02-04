/**
 * Delay Utility - Speed Optimized
 * All functions modified to return immediately for instant bot response.
 */

const config = require('../../config.json');

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    // Speed optimized: 0ms sleep
    return Promise.resolve();
}

/**
 * Get a random delay within configured range
 * @returns {number}
 */
function getRandomDelay(min = 0, max = 0) {
    return 0;
}

/**
 * Calculate typing delay
 * @returns {number}
 */
function getTypingDelay(message) {
    return 0;
}

/**
 * Human-like delay before responding (Instant)
 */
async function humanDelay(message = '') {
    return;
}

/**
 * Faster payout delay (Instant)
 */
async function fastDelay() {
    return;
}

/**
 * Quick action delay (Instant)
 */
async function quickDelay() {
    return;
}

/**
 * Game action delay (Instant)
 */
async function gameActionDelay() {
    return;
}


module.exports = {
    sleep,
    getRandomDelay,
    getTypingDelay,
    humanDelay,
    fastDelay,
    quickDelay,
    gameActionDelay
};
