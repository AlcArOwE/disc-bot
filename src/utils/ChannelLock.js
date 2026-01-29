/**
 * Channel Lock - Manages concurrency per channel
 * Ensures we don't spam a single channel while allowing parallel actions across multiple channels
 */

const { sleep } = require('./delay');

class ChannelLock {
    constructor() {
        this.locks = new Map();
        this.cooldownMs = 2500; // 2.5s safe limit
    }

    /**
     * Acquire lock for a channel
     * If locked, waits until available
     * @param {string} channelId
     */
    async acquire(channelId) {
        while (this.locks.has(channelId)) {
            const unlockTime = this.locks.get(channelId);
            const now = Date.now();
            if (now < unlockTime) {
                await sleep(unlockTime - now);
            } else {
                this.locks.delete(channelId);
            }
        }

        // Set lock for cooldown duration
        this.locks.set(channelId, Date.now() + this.cooldownMs);
    }

    /**
     * Check if channel is locked (non-blocking)
     * @param {string} channelId
     * @returns {boolean}
     */
    isLocked(channelId) {
        if (!this.locks.has(channelId)) return false;

        const unlockTime = this.locks.get(channelId);
        if (Date.now() >= unlockTime) {
            this.locks.delete(channelId);
            return false;
        }
        return true;
    }
}

const channelLock = new ChannelLock();
module.exports = { ChannelLock, channelLock };
