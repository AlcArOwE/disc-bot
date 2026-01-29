/**
 * Auto Advertiser - Autonomously posts advertisements
 */

const config = require('../../config.json');
const { logger } = require('../utils/logger');
const { ticketManager } = require('../state/TicketManager');
const { channelLock } = require('../utils/ChannelLock');
const { humanDelay } = require('../utils/delay');

class AutoAdvertiser {
    constructor() {
        this.client = null;
        this.timeout = null;
        this.isRunning = false;

        // Configuration
        this.enabled = config.auto_advertise?.enabled || false;
        this.baseInterval = config.auto_advertise?.interval_ms || 300000; // 5 mins default
        this.messages = config.auto_advertise?.messages || ["Wager? DM me."];
        this.channelIds = config.auto_advertise?.channels || [];
    }

    /**
     * Start the advertiser
     * @param {Client} client - Discord client
     */
    start(client) {
        if (this.isRunning) return;
        if (!this.enabled) {
            logger.info('AutoAdvertiser is disabled in config');
            return;
        }
        if (!client) {
            logger.error('AutoAdvertiser requires Discord client');
            return;
        }

        this.client = client;
        this.isRunning = true;
        logger.info('Starting AutoAdvertiser...');

        this.scheduleNextLoop();
    }

    /**
     * Stop the advertiser
     */
    stop() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        this.isRunning = false;
        logger.info('AutoAdvertiser stopped');
    }

    /**
     * Schedule next advertisement loop
     */
    scheduleNextLoop() {
        if (!this.isRunning) return;

        // Add random variance (+/- 2s) to appear more human
        const variance = (Math.random() * 4000) - 2000;
        const delay = this.baseInterval + variance;

        this.timeout = setTimeout(() => this.runLoop(), delay);
    }

    /**
     * Execute advertisement loop
     */
    async runLoop() {
        if (!this.isRunning) return;

        try {
            // Smart Mode: Skip if 3 or more tickets are active
            const activeTickets = ticketManager.getActiveTickets().length;
            if (activeTickets >= 3) {
                logger.debug(`Skipping advertisement: ${activeTickets} active tickets (Smart Mode)`);
                this.scheduleNextLoop();
                return;
            }

            // Select random message
            const message = this.messages[Math.floor(Math.random() * this.messages.length)];

            // Advertise in each configured channel
            for (const channelId of this.channelIds) {
                await this.advertiseInChannel(channelId, message);
                // Small delay between channels
                await new Promise(r => setTimeout(r, 2000));
            }

        } catch (error) {
            logger.error('AutoAdvertiser loop error', { error: error.message });
        }

        this.scheduleNextLoop();
    }

    /**
     * Send advertisement to a specific channel
     */
    async advertiseInChannel(channelId, content) {
        // Check channel lock
        if (!channelLock.acquire(channelId)) {
            logger.debug(`Skipping adv in ${channelId}: Channel locked`);
            return;
        }

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                logger.warn(`Could not fetch channel ${channelId}`);
                return;
            }

            // Human delay before typing/sending
            await humanDelay(content);

            await channel.send(content);
            logger.info(`Advertised in ${channel.name} (${channelId})`);

        } catch (error) {
            logger.error(`Failed to advertise in ${channelId}`, { error: error.message });
        }
    }
}

const autoAdvertiser = new AutoAdvertiser();
module.exports = { AutoAdvertiser, autoAdvertiser };
