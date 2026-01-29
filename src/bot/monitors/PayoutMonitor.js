/**
 * Payout Monitor - Autonomously verifies incoming payouts
 */
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { logger } = require('../../utils/logger');
const { getRecentTransactions } = require('../../crypto');
const config = require('../../../config.json');

class PayoutMonitor {
    constructor() {
        this.timer = null;
        this.processedTxIds = new Set();
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Load processed TxIds from tickets to avoid re-processing
        const allTickets = ticketManager.tickets.values();
        for (const t of allTickets) {
            if (t.data.payoutTxId) {
                this.processedTxIds.add(t.data.payoutTxId);
            }
        }

        this.timer = setInterval(() => this.runLoop(), 60000);
        logger.info('PayoutMonitor started');
    }

    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        logger.info('PayoutMonitor stopped');
    }

    async runLoop() {
        try {
            const tickets = ticketManager.getActiveTickets().filter(t => t.state === STATES.AWAITING_PAYOUT);
            if (tickets.length === 0) return;

            const txs = await getRecentTransactions(20);
            if (txs.length === 0) return;

            for (const ticket of tickets) {
                await this.checkTicket(ticket, txs);
            }
        } catch (error) {
            logger.error('PayoutMonitor loop error', { error: error.message });
        }
    }

    async checkTicket(ticket, txs) {
        // Expected amount: opponentBet + ourBet
        const expectedAmount = ticket.data.opponentBet + ticket.data.ourBet;
        const margin = 0.05; // Accept small variance (e.g. fees)

        for (const tx of txs) {
            if (this.processedTxIds.has(tx.txId)) continue;

            // Check time: Tx must be AFTER ticket update to AWAITING_PAYOUT
            // Or use ticket created time as broader check
            if (tx.timestamp < ticket.createdAt) continue;

            // Check amount
            if (Math.abs(tx.amount - expectedAmount) <= margin) {
                logger.info('Payout verified', {
                    channelId: ticket.channelId,
                    txId: tx.txId,
                    amount: tx.amount
                });

                ticket.transition(STATES.GAME_COMPLETE, {
                    payoutTxId: tx.txId,
                    payoutAmount: tx.amount,
                    payoutVerified: true
                });
                saveState();

                this.processedTxIds.add(tx.txId);

                // Remove from active management
                ticketManager.removeTicket(ticket.channelId);

                return;
            }
        }
    }
}

module.exports = PayoutMonitor;
