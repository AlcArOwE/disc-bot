/**
 * TicketDiscovery - Reliable ticket detection via multiple signals
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');
const { ticketManager } = require('../state/TicketManager');
const { STATES } = require('../state/StateMachine');

class TicketDiscovery {
    constructor(client) {
        this.client = client;
        this.ticketPatterns = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-', 'support-'];
    }

    /**
     * Start the discovery service
     */
    async start() {
        logger.info('🚀 TICKET_DISCOVERY_STARTED');

        // 4. Initial scan on startup
        await this.scanGuilds();
    }

    /**
     * Scan all guilds for existing ticket channels
     */
    async scanGuilds() {
        logger.info('🔍 SCANNING_GUILDS_FOR_TICKETS...');
        for (const guild of this.client.guilds.cache.values()) {
            const channels = guild.channels.cache.filter(c => this.isTicketChannel(c));
            for (const channel of channels.values()) {
                await this.initializeTicket(channel, 'startup_scan');
            }
        }
    }

    /**
     * 1. Handle channelCreate event
     */
    async handleChannelCreate(channel) {
        if (this.isTicketChannel(channel)) {
            await this.initializeTicket(channel, 'channel_create');
        }
    }

    /**
     * 3. Handle channelUpdate (e.g. permission overwrite changes)
     */
    async handleChannelUpdate(oldChannel, newChannel) {
        // If we suddenly gain view permissions for a ticket channel
        const canSeeNow = newChannel.viewable;
        const couldNotSeeBefore = !oldChannel.viewable;

        if (canSeeNow && couldNotSeeBefore && this.isTicketChannel(newChannel)) {
            await this.initializeTicket(newChannel, 'permission_gain');
        }
    }

    /**
     * Check if a channel matches ticket patterns
     */
    isTicketChannel(channel) {
        const name = channel.name?.toLowerCase() || '';
        const isPatternMatch = this.ticketPatterns.some(p => name.includes(p.toLowerCase()));
        return isPatternMatch && channel.type === 'GUILD_TEXT';
    }

    /**
     * Initialize a ticket in the state machine
     */
    async initializeTicket(channel, method) {
        if (ticketManager.getTicket(channel.id)) return;

        logger.info('🎫 TICKET_DETECTED', {
            channelId: channel.id,
            name: channel.name,
            categoryId: channel.parentId,
            detectionMethod: method
        });

        // Create the ticket state
        const ticket = ticketManager.getTicket(channel.id) || ticketManager.createTicket(channel.id, {
            autoDetected: true,
            detectionMethod: method
        });

        if (ticket.getState() === STATES.AWAITING_TICKET) {
            ticket.transition(STATES.AWAITING_MIDDLEMAN);
        }

        // Trigger history analysis via TicketHandler (will be called in handleMessage)
        // For now, just ensuring it's in the state machine
    }
}

module.exports = TicketDiscovery;
