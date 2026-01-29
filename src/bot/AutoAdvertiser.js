/**
 * Auto Advertiser - Periodically sends promotional messages
 */
const config = require('../../config.json');
const { logger } = require('../utils/logger');
const { ticketManager } = require('../state/TicketManager');
const { acquire, release } = require('../utils/ChannelLock');

class AutoAdvertiser {
    constructor(client) {
        this.client = client;
        this.timer = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        if (!config.auto_advertise?.enabled) {
            logger.info('AutoAdvertiser disabled in config');
            return;
        }

        this.isRunning = true;
        this.scheduleNextLoop();
        logger.info('AutoAdvertiser started');
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('AutoAdvertiser stopped');
    }

    scheduleNextLoop() {
        if (!this.isRunning) return;

        // Base interval +/- 2 seconds variance
        const baseInterval = config.auto_advertise.interval_ms || 120000;
        const variance = (Math.random() * 4000) - 2000;
        const delay = Math.max(1000, baseInterval + variance);

        this.timer = setTimeout(() => this.runLoop(), delay);
    }

    async runLoop() {
        try {
            await this.advertise();
        } catch (error) {
            logger.error('AutoAdvertise loop error', { error: error.message });
        } finally {
            this.scheduleNextLoop();
        }
    }

    async advertise() {
        // Smart Mode: Skip if >= 3 active tickets
        const activeCount = ticketManager.getActiveTickets().length;
        if (activeCount >= 3) {
            logger.debug('Skipping advertisement: High load', { activeCount });
            return;
        }

        const channels = config.channels.monitored_channels || [];
        if (channels.length === 0) return;

        // Pick a random message
        const messages = config.auto_advertise.messages;
        if (!messages || messages.length === 0) return;
        const message = messages[Math.floor(Math.random() * messages.length)];

        for (const channelId of channels) {
            if (!this.isRunning) break;

            try {
                // Check channel lock
                if (!await acquire(channelId)) {
                    continue;
                }

                const channel = await this.client.channels.fetch(channelId);
                if (channel) {
                    await channel.send(message);
                    logger.info('Advertised in channel', { channelId });
                }

                // Wait a bit before releasing/next channel to avoid burst
                await new Promise(r => setTimeout(r, 2000));
                release(channelId);

            } catch (error) {
                // Ignore errors (e.g., channel not found, permission denied)
                // logger.warn('Failed to advertise', { channelId, error: error.message });
                release(channelId);
            }
        }
    }
}

module.exports = AutoAdvertiser;
