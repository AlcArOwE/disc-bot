/**
 * AutoAdvertiser - Automatically sends promotional messages
 */
const config = require('../../config.json');
const { logger } = require('../utils/logger');
const { humanDelay } = require('../utils/delay');
const channelLock = require('../utils/ChannelLock');
const { ticketManager } = require('../state/TicketManager');

class AutoAdvertiser {
    constructor(client) {
        this.client = client;
        this.timer = null;
        this.enabled = config.auto_advertise?.enabled || false;
        this.baseInterval = config.auto_advertise?.interval_ms || 300000; // 5 mins default
        this.messages = config.auto_advertise?.messages || ["Waiting for wagers!"];
        this.monitoredChannels = config.channels?.monitored_channels || [];
    }

    start() {
        if (!this.enabled) {
            logger.info('AutoAdvertiser disabled in config');
            return;
        }

        if (this.monitoredChannels.length === 0) {
            logger.warn('No monitored channels configured for AutoAdvertiser');
            return;
        }

        logger.info('Starting AutoAdvertiser', { interval: this.baseInterval });
        this.scheduleNext();
    }

    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            logger.info('Stopped AutoAdvertiser');
        }
    }

    scheduleNext() {
        // Random variance +/- 2s (2000ms)
        const variance = (Math.random() * 4000) - 2000;
        const delay = this.baseInterval + variance;

        this.timer = setTimeout(() => this.advertiseLoop(), delay);
    }

    async advertiseLoop() {
        try {
            // Smart Mode: Skip if busy
            const activeTickets = ticketManager.getActiveTickets().length;
            if (activeTickets >= 3) {
                logger.debug('Skipping advertisement (Smart Mode)', { activeTickets });
                this.scheduleNext();
                return;
            }

            // Pick a random channel
            const channelId = this.monitoredChannels[Math.floor(Math.random() * this.monitoredChannels.length)];

            // Check lock
            if (channelLock.isLocked(channelId)) {
                this.scheduleNext();
                return;
            }

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                logger.warn('Could not fetch monitored channel', { channelId });
                this.scheduleNext();
                return;
            }

            // Pick random message
            const message = this.messages[Math.floor(Math.random() * this.messages.length)];

            // Acquire lock and send
            if (channelLock.acquire(channelId)) {
                await humanDelay(); // Ensure we don't spam instantly
                await channel.send(message);
                logger.info('Sent advertisement', { channelId, message });
            }

        } catch (error) {
            logger.error('AutoAdvertiser error', { error: error.message });
        } finally {
            this.scheduleNext();
        }
    }
}

module.exports = AutoAdvertiser;
