/**
 * Auto Advertiser - Automatically sends promotional messages
 */
const { channelLock } = require('../utils/ChannelLock');
const config = require('../../config.json');
const { logger } = require('../utils/logger');
const { ticketManager } = require('../state/TicketManager');
const { humanDelay } = require('../utils/delay');

class AutoAdvertiser {
    constructor() {
        this.interval = null;
        this.client = null;
    }

    /**
     * Start the advertiser
     * @param {Client} client - Discord client
     */
    start(client) {
        if (this.interval) return;
        this.client = client;

        const cfg = config.auto_advertise;
        if (!cfg || !cfg.enabled) {
            logger.info('AutoAdvertiser disabled in config');
            return;
        }

        logger.info('Starting AutoAdvertiser...', { interval: cfg.interval_ms });

        // Start loop
        this.scheduleNext();
    }

    stop() {
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
    }

    scheduleNext() {
        const cfg = config.auto_advertise;
        if (!cfg || !cfg.enabled) return;

        // Base interval + random variance (+/- 2s)
        const variance = (Math.random() * 4000) - 2000;
        const delay = (cfg.interval_ms || 300000) + variance;

        this.interval = setTimeout(() => this.advertise(), delay);
    }

    async advertise() {
        try {
            // Smart Mode: Skip if 3+ active tickets
            const activeTickets = ticketManager.getActiveTickets();
            if (activeTickets.length >= 3) {
                logger.info('AutoAdvertiser skipping (Smart Mode: busy)');
                this.scheduleNext();
                return;
            }

            const channels = config.channels.monitored_channels || [];
            if (channels.length === 0) {
                this.scheduleNext();
                return;
            }

            const messages = config.auto_advertise.messages;
            if (!messages || messages.length === 0) {
                this.scheduleNext();
                return;
            }

            for (const channelId of channels) {
                // Check lock
                if (!channelLock.acquire(channelId)) {
                    continue;
                }

                try {
                    const channel = await this.client.channels.fetch(channelId);
                    if (!channel) continue;

                    // Select random message
                    const msg = messages[Math.floor(Math.random() * messages.length)];

                    // Send with human delay
                    await humanDelay();
                    await channel.send(msg);

                    logger.info('AutoAdvertiser sent message', { channelId, msg });
                } catch (err) {
                    logger.error('AutoAdvertiser failed to send', { channelId, error: err.message });
                }
            }

        } catch (error) {
            logger.error('AutoAdvertiser error', { error: error.message });
        }

        this.scheduleNext();
    }
}

const autoAdvertiser = new AutoAdvertiser();
module.exports = { AutoAdvertiser, autoAdvertiser };
