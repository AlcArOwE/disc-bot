/**
 * Stale Ticket Monitor - Detects and manages inactive tickets
 */
const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { humanDelay } = require('../../utils/delay');

class StaleTicketMonitor {
    constructor(client) {
        this.client = client;
        this.timer = null;
        this.intervalMs = 300000; // 5 minutes
        this.bumpThreshold = 900000; // 15 minutes
        this.closeThreshold = 3600000; // 1 hour
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('Starting StaleTicketMonitor');
        this.monitorLoop();
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('Stopped StaleTicketMonitor');
    }

    async monitorLoop() {
        if (!this.isRunning) return;

        try {
            await this.checkStaleTickets();
        } catch (error) {
            logger.error('StaleTicketMonitor error', { error: error.message });
        }

        if (this.isRunning) {
            this.timer = setTimeout(() => this.monitorLoop(), this.intervalMs);
        }
    }

    async checkStaleTickets() {
        const now = Date.now();
        const tickets = ticketManager.getActiveTickets();

        for (const ticket of tickets) {
            const timeSinceUpdate = now - ticket.updatedAt;

            // Don't bump if game is in progress (players might be slow but playing)
            // But if it's been an hour, maybe close it?

            if (timeSinceUpdate > this.closeThreshold) {
                await this.closeTicket(ticket);
            } else if (timeSinceUpdate > this.bumpThreshold) {
                await this.bumpTicket(ticket);
            }
        }
    }

    async bumpTicket(ticket) {
        // Don't bump games in progress to avoid disrupting flow
        if (ticket.state === STATES.GAME_IN_PROGRESS) return;

        logger.info('Bumping stale ticket', { channelId: ticket.channelId, state: ticket.state });

        const channel = await this.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) {
            await humanDelay();
            await channel.send(`Ticket inactive for ${(this.bumpThreshold/60000).toFixed(0)}m. Are we continuing?`);

            // Update timestamp to avoid spamming bumps
            ticket.updateData({});
            saveState();
        }
    }

    async closeTicket(ticket) {
        logger.info('Closing stale ticket', { channelId: ticket.channelId });

        const channel = await this.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) {
            await humanDelay();
            await channel.send('Ticket closed due to inactivity.');
        }

        ticket.transition(STATES.CANCELLED, { reason: 'Timeout' });
        saveState();
        ticketManager.removeTicket(ticket.channelId);
    }
}

module.exports = StaleTicketMonitor;
