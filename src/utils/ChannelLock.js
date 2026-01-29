/**
 * Channel Lock - Prevents race conditions and spam in channels
 */

const { logger } = require('./logger');

class ChannelLock {
    constructor() {
        this.locks = new Map();
        // Default lock duration if not specified
        this.defaultDuration = 2500;
    }

    /**
     * Attempt to acquire a lock for a channel
     * @param {string} channelId
     * @param {number} durationMs - Optional custom duration
     * @returns {boolean} - True if lock acquired, false if already locked
     */
    acquire(channelId, durationMs = this.defaultDuration) {
        const now = Date.now();
        const expiry = this.locks.get(channelId);

        if (expiry && now < expiry) {
            return false;
        }

        this.locks.set(channelId, now + durationMs);
        return true;
    }

    /**
     * Release a lock immediately
     * @param {string} channelId
     */
    release(channelId) {
        this.locks.delete(channelId);
    }

    /**
     * Check if channel is locked without acquiring
     * @param {string} channelId
     * @returns {boolean}
     */
    isLocked(channelId) {
        const expiry = this.locks.get(channelId);
        return expiry && Date.now() < expiry;
    }
}

// Singleton instance
const channelLock = new ChannelLock();
module.exports = { ChannelLock, channelLock };
