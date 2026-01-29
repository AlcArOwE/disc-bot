/**
 * Stale Ticket Monitor - Cleans up old tickets
 */
const { ticketManager } = require('../../state/TicketManager');
const { logger } = require('../../utils/logger');
const { STATES } = require('../../state/StateMachine');

class StaleTicketMonitor {
    constructor() {
        this.timer = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.timer = setInterval(() => this.runLoop(), 5 * 60 * 1000); // Check every 5 mins
        logger.info('StaleTicketMonitor started');
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        logger.info('StaleTicketMonitor stopped');
    }

    runLoop() {
        try {
            this.checkStaleTickets();
        } catch (error) {
            logger.error('StaleTicketMonitor loop error', { error: error.message });
        }
    }

    checkStaleTickets() {
        const now = Date.now();
        const tickets = ticketManager.getActiveTickets();

        // 1 hour timeout for inactive tickets
        const STALE_THRESHOLD = 60 * 60 * 1000;

        // 10 minute warning/bump (internal log only as requested)
        const BUMP_THRESHOLD = 10 * 60 * 1000;

        for (const ticket of tickets) {
            const timeSinceUpdate = now - ticket.updatedAt;

            if (timeSinceUpdate > STALE_THRESHOLD) {
                // If in critical state (payment sent but no game?), alert
                if (ticket.state === STATES.PAYMENT_SENT || ticket.state === STATES.AWAITING_GAME_START || ticket.state === STATES.GAME_IN_PROGRESS || ticket.state === STATES.AWAITING_PAYOUT) {
                    logger.warn('Stale ticket in CRITICAL state', {
                        channelId: ticket.channelId,
                        state: ticket.state,
                        ageMin: Math.floor(timeSinceUpdate / 60000)
                    });
                    // Don't auto-close if money is involved/in-flight
                    continue;
                }

                // For AWAITING_TICKET/MIDDLEMAN/ADDRESS, safe to close
                if ([STATES.AWAITING_TICKET, STATES.AWAITING_MIDDLEMAN, STATES.AWAITING_PAYMENT_ADDRESS].includes(ticket.state)) {
                    logger.info('Closing stale ticket', { channelId: ticket.channelId });
                    ticket.transition(STATES.CANCELLED, { reason: 'Timeout' });
                    ticketManager.removeTicket(ticket.channelId);
                }
            } else if (timeSinceUpdate > BUMP_THRESHOLD) {
                // Just log it
                logger.debug('Ticket inactive', {
                    channelId: ticket.channelId,
                    state: ticket.state,
                    minutes: Math.floor(timeSinceUpdate / 60000)
                });
            }
        }

        // Also clean up old completed tickets
        ticketManager.cleanupOldTickets();
    }
}

module.exports = StaleTicketMonitor;
