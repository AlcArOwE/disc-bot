/**
 * Auto Advertiser - Periodically sends promotional messages
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');
const { channelLock } = require('../utils/ChannelLock');
const { ticketManager } = require('../state/TicketManager');
const { getRandomDelay } = require('../utils/delay');

class AutoAdvertiser {
    constructor() {
        this.client = null;
        this.interval = null;
        this.isRunning = false;
    }

    /**
     * Start the advertiser
     * @param {Client} client - Discord client
     */
    start(client) {
        if (this.isRunning) return;

        const settings = config.auto_advertise || {};
        if (!settings.enabled) {
            logger.info('Auto-advertise disabled in config');
            return;
        }

        this.client = client;
        this.isRunning = true;

        // Default to 15 seconds if not set or too low (safety)
        const intervalMs = Math.max(settings.interval_ms || 15000, 5000);

        logger.info('Starting Auto-Advertiser', { intervalMs });

        // Add fuzziness to interval to avoid bot-like regularity
        const scheduleNext = () => {
            if (!this.isRunning) return;
            const variance = getRandomDelay(-2000, 2000);
            const nextDelay = Math.max(5000, intervalMs + variance);

            this.interval = setTimeout(async () => {
                try {
                    await this.advertise();
                } catch (e) {
                    logger.error('Advertiser loop error', { error: e.message });
                }
                scheduleNext();
            }, nextDelay);
        };

        scheduleNext();
    }

    /**
     * Stop the advertiser
     */
    stop() {
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('Auto-Advertiser stopped');
    }

    /**
     * Send advertisement
     */
    async advertise() {
        if (!this.client || !this.isRunning) return;

        // Smart Mode: Skip if too many active tickets
        // (Don't advertise if we are busy)
        const activeTickets = ticketManager.getActiveTickets().length;
        if (activeTickets >= 3) {
            logger.debug('Skipping advertisement (too many active tickets)', { activeTickets });
            return;
        }

        const settings = config.auto_advertise;
        const channels = config.channels.monitored_channels || [];

        if (channels.length === 0) {
            logger.warn('No channels configured for auto-advertising');
            return;
        }

        for (const channelId of channels) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                if (!channel) continue;

                // Basic check to avoid spamming if we were the last one to speak
                if (channel.lastMessageId) {
                    try {
                        const lastMsg = await channel.messages.fetch(channel.lastMessageId);
                        if (lastMsg && lastMsg.author.id === this.client.user.id) {
                            logger.debug('Skipping advertisement, we sent the last message', { channelId });
                            continue;
                        }
                    } catch (e) {
                        // Ignore fetch error, proceed
                    }
                }

                // Get message (handle array or string)
                let msgContent = settings.message;
                if (Array.isArray(msgContent)) {
                    msgContent = msgContent[Math.floor(Math.random() * msgContent.length)];
                }

                // Use lock to respect per-channel rate limits
                await channelLock.acquire(channelId);
                await channel.send(msgContent);
                logger.info('Advertisement sent', { channelId });

            } catch (error) {
                logger.error('Failed to send advertisement', {
                    channelId,
                    error: error.message
                });
            }
        }
    }
}

const autoAdvertiser = new AutoAdvertiser();
module.exports = { AutoAdvertiser, autoAdvertiser };
