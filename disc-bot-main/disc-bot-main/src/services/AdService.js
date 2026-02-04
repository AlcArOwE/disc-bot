/**
 * Advertising Service
 * Handles recurring broadcast messages in public channels.
 */

const { logger } = require('../utils/logger');
const { messageQueue } = require('../utils/MessageQueue');
const config = require('../../config.json');

class AdService {
    constructor() {
        this.interval = null;
        this.client = null;
    }

    /**
     * Start the advertising loop
     * @param {Client} client 
     */
    start(client) {
        if (!config.advertising?.enabled) {
            logger.info('📢 AdService: Disabled in config');
            return;
        }

        this.client = client;
        const intervalMs = (config.advertising.interval_minutes || 10) * 60 * 1000;

        logger.info(`📢 AdService: Started. Interval: ${config.advertising.interval_minutes}m`);

        // Initial burst (random delay 5-15s to not spam on restart)
        setTimeout(() => this.sendAd(), 5000 + Math.random() * 10000);

        this.interval = setInterval(() => {
            this.sendAd();
        }, intervalMs);
    }

    /**
     * Stop the advertising loop
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('📢 AdService: Stopped');
        }
    }

    /**
     * Send a randomized ad message
     */
    async sendAd() {
        try {
            const channelId = config.advertising.channel_id;
            const channel = await this.client.channels.fetch(channelId);

            if (!channel) {
                logger.error(`📢 AdService: Channel ${channelId} not found`);
                return;
            }

            const templates = config.advertising.templates || [];
            if (templates.length === 0) return;

            // Randomly pick a template
            const message = templates[Math.floor(Math.random() * templates.length)];

            logger.info('📢 AdService: Sending broadcast...', { channelId });
            await messageQueue.send(channel, message);

        } catch (error) {
            logger.error('📢 AdService: Error sending ad', { error: error.message });
        }
    }
}

module.exports = new AdService();
