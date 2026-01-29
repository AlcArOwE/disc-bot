/**
 * Channel Lock - Manages per-channel rate limits
 */
class ChannelLock {
    constructor() {
        this.locks = new Map();
        // Default 2.5s delay if not specified
        this.defaultDelay = 2500;
    }

    /**
     * Attempt to acquire lock for a channel
     * @param {string} channelId
     * @param {number} delayMs - Optional override for delay
     * @returns {boolean} - True if lock acquired
     */
    acquire(channelId, delayMs = this.defaultDelay) {
        const now = Date.now();
        const lastTime = this.locks.get(channelId);

        if (lastTime && (now - lastTime) < delayMs) {
            return false;
        }

        this.locks.set(channelId, now);
        return true;
    }

    /**
     * Release lock (not typically needed if using time-based check, but good for resetting)
     * @param {string} channelId
     */
    release(channelId) {
        this.locks.delete(channelId);
    }
}

const channelLock = new ChannelLock();
module.exports = { ChannelLock, channelLock };
