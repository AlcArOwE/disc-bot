/**
 * Channel Lock - Enforces rate limits per channel
 */

const locks = new Map();
const LOCK_DURATION = 2500;

/**
 * Attempt to acquire lock for a channel
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
async function acquire(channelId) {
    const now = Date.now();
    const last = locks.get(channelId);

    if (last && now - last < LOCK_DURATION) {
        return false;
    }

    locks.set(channelId, now);
    return true;
}

/**
 * Release lock (not strictly necessary with time-based, but good practice if we want to force clear)
 * @param {string} channelId
 */
function release(channelId) {
    // locks.delete(channelId); // Don't delete, we want the time constraint to persist
}

module.exports = { acquire, release };
