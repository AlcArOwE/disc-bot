/**
 * Payout Monitor - Scans for incoming payout transactions
 */
const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { getCurrentHandler } = require('../../crypto');
const { humanDelay } = require('../../utils/delay');

class PayoutMonitor {
    constructor(client) {
        this.client = client;
        this.timer = null;
        this.processedTxIds = new Set();
        this.intervalMs = 10000; // 10 seconds
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('Starting PayoutMonitor');
        this.monitorLoop();
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('Stopped PayoutMonitor');
    }

    async monitorLoop() {
        if (!this.isRunning) return;

        try {
            await this.checkPayouts();
        } catch (error) {
            logger.error('PayoutMonitor error', { error: error.message });
        }

        if (this.isRunning) {
            this.timer = setTimeout(() => this.monitorLoop(), this.intervalMs);
        }
    }

    async checkPayouts() {
        // Find tickets waiting for payout
        const pendingTickets = ticketManager.getActiveTickets().filter(t => t.getState() === STATES.AWAITING_PAYOUT);

        if (pendingTickets.length === 0) return;

        logger.debug('Checking payouts', { count: pendingTickets.length });

        const handler = getCurrentHandler();
        // Fetch recent transactions
        const recentTxs = await handler.getRecentTransactions(20);

        for (const ticket of pendingTickets) {
            const totalPot = ticket.data.ourBet + ticket.data.opponentBet;
            // Allow small tolerance for fees/rounding (e.g., 0.1%)
            const tolerance = totalPot * 0.001;

            // Look for matching transaction
            const match = recentTxs.find(tx => {
                if (this.processedTxIds.has(tx.txId)) return false;

                // Timestamp check: must be after game started
                if (tx.timestamp < ticket.createdAt) return false;

                const diff = Math.abs(tx.amount - totalPot);
                return diff <= tolerance;
            });

            if (match) {
                await this.handlePayoutVerified(ticket, match);
            }
        }
    }

    async handlePayoutVerified(ticket, tx) {
        logger.info('Payout verified', {
            channelId: ticket.channelId,
            txId: tx.txId,
            amount: tx.amount
        });

        this.processedTxIds.add(tx.txId);

        ticket.transition(STATES.GAME_COMPLETE, {
            payoutTxId: tx.txId,
            payoutAmount: tx.amount,
            payoutVerifiedAt: Date.now()
        });
        saveState();

        const channel = await this.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) {
            await humanDelay();
            await channel.send(`Payment received! ${tx.amount} verified. Game complete.`);
        }

        ticketManager.removeTicket(ticket.channelId);
    }
}

module.exports = PayoutMonitor;
