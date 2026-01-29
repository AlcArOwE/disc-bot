/**
 * Payout Monitor - Autonomously verifies incoming payouts
 */

const config = require('../../../config.json');
const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const LitecoinHandler = require('../../crypto/LitecoinHandler');
const SolanaHandler = require('../../crypto/SolanaHandler');

class PayoutMonitor {
    constructor() {
        this.interval = null;
        this.processedTxIds = new Set();
        this.isRunning = false;

        // Initialize handlers
        this.ltcHandler = new LitecoinHandler();
        this.solHandler = new SolanaHandler();
    }

    /**
     * Start the monitor
     */
    start() {
        if (this.isRunning) return;

        logger.info('Starting PayoutMonitor...');
        this.isRunning = true;

        // Run immediately then interval
        this.checkPayouts();
        this.interval = setInterval(() => this.checkPayouts(), 60000); // 60s
    }

    /**
     * Stop the monitor
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('PayoutMonitor stopped');
    }

    /**
     * Check for payouts
     */
    async checkPayouts() {
        try {
            // Get tickets waiting for payout
            const tickets = ticketManager.getActiveTickets().filter(t => t.state === STATES.AWAITING_PAYOUT);

            if (tickets.length === 0) return;

            logger.debug(`Checking payouts for ${tickets.length} tickets`);

            // Get recent transactions based on network
            let transactions = [];
            const network = config.crypto_network;

            if (network === 'LTC') {
                transactions = await this.ltcHandler.getRecentTransactions();
            } else if (network === 'SOL') {
                transactions = await this.solHandler.getRecentTransactions();
            }

            if (transactions.length === 0) return;

            // Filter out already processed transactions
            const newTransactions = transactions.filter(tx => !this.processedTxIds.has(tx.txId));

            for (const ticket of tickets) {
                await this.processTicket(ticket, newTransactions);
            }

        } catch (error) {
            logger.error('PayoutMonitor error', { error: error.message });
        }
    }

    /**
     * Process a single ticket against transactions
     */
    async processTicket(ticket, transactions) {
        // Calculate expected amount (Total Pot)
        // Note: Amounts are floating point, so we need a small epsilon for comparison
        const expectedAmount = ticket.data.ourBet + ticket.data.opponentBet;
        const epsilon = 0.0001;

        for (const tx of transactions) {
            // Check amount
            if (Math.abs(tx.amount - expectedAmount) > epsilon) continue;

            // Check timestamp (must be after ticket entered payout state)
            // Giving a 5 minute buffer in case transaction was sent slightly before we updated state
            // or clocks are desync
            const cutoffTime = ticket.updatedAt - (5 * 60 * 1000);
            if (tx.timestamp < cutoffTime) continue;

            // Found a match!
            logger.info('Payout verified!', {
                channelId: ticket.channelId,
                txId: tx.txId,
                amount: tx.amount
            });

            this.processedTxIds.add(tx.txId);

            // Transition to complete
            ticket.transition(STATES.GAME_COMPLETE, {
                payoutTxId: tx.txId,
                payoutAmount: tx.amount,
                payoutVerified: true
            });
            saveState();

            // Try to notify in channel if client is available (this is tricky as we don't have client ref here easily)
            // usage of ticket.channelId implies we might need to pass client or just log it.
            // For now, we update state. The main loop or manual check can see it's done.
            // Ideally, we would have a way to send a message.
            // We can emit an event if we had an event emitter, or just rely on the state change.

            break; // Ticket handled
        }
    }
}

const payoutMonitor = new PayoutMonitor();
module.exports = { PayoutMonitor, payoutMonitor };
