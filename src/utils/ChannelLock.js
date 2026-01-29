/**
 * ChannelLock - Enforces rate limits per channel
 */

class ChannelLock {
    constructor() {
        this.locks = new Map();
        this.defaultDuration = 2500; // 2.5 seconds
    }

    /**
     * Attempt to acquire a lock for a channel
     * @param {string} channelId
     * @param {number} duration
     * @returns {boolean} True if acquired, False if locked
     */
    acquire(channelId, duration = this.defaultDuration) {
        if (this.isLocked(channelId)) {
            return false;
        }

        const timeout = setTimeout(() => {
            this.locks.delete(channelId);
        }, duration);

        this.locks.set(channelId, timeout);
        return true;
    }

    isLocked(channelId) {
        return this.locks.has(channelId);
    }
}

module.exports = new ChannelLock();
