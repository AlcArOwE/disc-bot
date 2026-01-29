/**
 * Stale Ticket Monitor - Cleans up old inactive tickets
 */
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { logger } = require('../../utils/logger');
const { saveState } = require('../../state/persistence');

class StaleTicketMonitor {
    constructor() {
        this.interval = null;
        this.staleThreshold = 60 * 60 * 1000; // 1 hour
    }

    start() {
        if (this.interval) return;

        logger.info('Starting StaleTicketMonitor...');
        this.interval = setInterval(() => this.checkStaleTickets(), 5 * 60 * 1000); // Check every 5 mins
        this.checkStaleTickets(); // Initial check
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    checkStaleTickets() {
        const now = Date.now();
        const tickets = ticketManager.getActiveTickets();

        let cleaned = 0;

        for (const ticket of tickets) {
            // Skip tickets that are complete (handled by cleanupOldTickets)
            if (ticket.isComplete()) continue;

            // Check if ticket is stale
            if (now - ticket.updatedAt > this.staleThreshold) {
                // If payment was sent, we should be careful
                if (ticket.state === STATES.PAYMENT_SENT || ticket.state === STATES.AWAITING_GAME_START) {
                   logger.warn('Stale ticket has payment sent!', { channelId: ticket.channelId });
                   // Maybe don't auto-cancel if money involved?
                   // Just log for manual intervention
                   continue;
                }

                logger.info('Closing stale ticket', {
                    channelId: ticket.channelId,
                    state: ticket.state,
                    age: Math.floor((now - ticket.updatedAt) / 1000) + 's'
                });

                ticket.transition(STATES.CANCELLED, { reason: 'Stale/Inactive' });
                cleaned++;
            }
        }

        if (cleaned > 0) {
            saveState();
            logger.info(`Cleaned up ${cleaned} stale tickets`);
        }

        // Also run cleanup for old completed tickets
        ticketManager.cleanupOldTickets();
    }
}

const staleTicketMonitor = new StaleTicketMonitor();
module.exports = { StaleTicketMonitor, staleTicketMonitor };
