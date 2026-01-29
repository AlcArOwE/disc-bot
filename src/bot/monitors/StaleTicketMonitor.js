/**
 * Stale Ticket Monitor - Cleans up inactive tickets
 */

const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');

class StaleTicketMonitor {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        // 1 hour timeout
        this.timeoutMs = 60 * 60 * 1000;
        // Check every 5 minutes
        this.checkInterval = 5 * 60 * 1000;
    }

    start() {
        if (this.isRunning) return;

        logger.info('Starting StaleTicketMonitor...');
        this.isRunning = true;

        this.interval = setInterval(() => this.checkStaleTickets(), this.checkInterval);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('StaleTicketMonitor stopped');
    }

    checkStaleTickets() {
        try {
            const now = Date.now();
            const tickets = ticketManager.getActiveTickets();

            let closedCount = 0;

            for (const ticket of tickets) {
                // If ticket hasn't been updated in timeoutMs
                if (now - ticket.updatedAt > this.timeoutMs) {
                    // Log a "bump" (internal log)
                    logger.info(`Ticket ${ticket.channelId} is stale (last update: ${new Date(ticket.updatedAt).toISOString()})`);

                    // Close the ticket
                    logger.info(`Closing stale ticket ${ticket.channelId}`);
                    ticketManager.removeTicket(ticket.channelId);
                    closedCount++;
                }
            }

            if (closedCount > 0) {
                logger.info(`Cleaned up ${closedCount} stale tickets`);
            }

        } catch (error) {
            logger.error('StaleTicketMonitor error', { error: error.message });
        }
    }
}

const staleTicketMonitor = new StaleTicketMonitor();
module.exports = { StaleTicketMonitor, staleTicketMonitor };
