/**
 * Stale Ticket Monitor - Bumps tickets that are stuck waiting
 */

const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { channelLock } = require('../../utils/ChannelLock');

class StaleTicketMonitor {
    constructor() {
        this.client = null;
        this.interval = null;
        // Check every minute
        this.checkInterval = 60 * 1000;
        // Consider stale after 5 minutes
        this.staleThreshold = 5 * 60 * 1000;
    }

    start(client) {
        if (this.interval) return;
        this.client = client;
        logger.info('Starting Stale Ticket Monitor');
        this.interval = setInterval(async () => {
            try {
                await this.checkTickets();
            } catch (e) {
                logger.error('StaleTicketMonitor loop error', { error: e.message });
            }
        }, this.checkInterval);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async checkTickets() {
        const now = Date.now();
        const tickets = ticketManager.getActiveTickets();

        for (const ticket of tickets) {
            // Only bump tickets waiting for middleman
            if (ticket.getState() !== STATES.AWAITING_MIDDLEMAN) continue;

            // Check if stale
            if (now - ticket.updatedAt > this.staleThreshold) {
                // Check if we already bumped recently (to avoid spamming bump every minute)
                // We'll use a local tracking or just rely on updatedAt update?
                // Updating ticket data updates updatedAt, so that works.

                try {
                    const channel = await this.client.channels.fetch(ticket.channelId);
                    if (!channel) continue;

                    // Acquire lock to respect rate limits
                    if (channelLock.isLocked(ticket.channelId)) continue;

                    await channelLock.acquire(ticket.channelId);
                    await channel.send('Still waiting for a middleman... (bump)');

                    // Update timestamp to reset stale timer
                    ticket.updateData({ lastBumped: now });

                    logger.info('Bumped stale ticket', { channelId: ticket.channelId });
                } catch (error) {
                    logger.warn('Failed to bump ticket', { channelId: ticket.channelId, error: error.message });
                }
            }
        }
    }
}

const staleTicketMonitor = new StaleTicketMonitor();
module.exports = { StaleTicketMonitor, staleTicketMonitor };
