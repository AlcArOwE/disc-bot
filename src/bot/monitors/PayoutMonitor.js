/**
 * Payout Monitor - Tracks incoming payments for winning tickets
 */

const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { getRecentTransactions } = require('../../crypto');
const { postVouch } = require('../handlers/ticket');
const { channelLock } = require('../../utils/ChannelLock');
const { saveState } = require('../../state/persistence');

class PayoutMonitor {
    constructor() {
        this.client = null;
        this.interval = null;
        // Check every minute
        this.checkInterval = 60 * 1000;
        // Track processed transactions to prevent double-spending
        this.processedTxIds = new Set();
    }

    start(client) {
        if (this.interval) return;
        this.client = client;
        logger.info('Starting Payout Monitor');
        // Wrap in try/catch to ensure loop doesn't die
        this.interval = setInterval(async () => {
            try {
                await this.checkPayouts();
            } catch (e) {
                logger.error('PayoutMonitor loop error', { error: e.message });
            }
        }, this.checkInterval);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async checkPayouts() {
        const waitingTickets = ticketManager.getActiveTickets().filter(t => t.getState() === STATES.AWAITING_PAYOUT);

        if (waitingTickets.length === 0) return;

        try {
            // Get recent transactions (last ~10)
            const txs = await getRecentTransactions(20);

            for (const ticket of waitingTickets) {
                // Expected amount is opponent's bet (approximate match due to fees?)
                // Usually payout is exact wager amount from middleman
                const expectedAmount = ticket.data.opponentBet;

                // Find matching tx
                // Needs to be newer than game end time
                const gameEndTime = ticket.data.gameEndedAt || ticket.updatedAt;

                const match = txs.find(tx => {
                    // Skip if already processed
                    if (this.processedTxIds.has(tx.hash)) return false;

                    const isRecent = tx.time > gameEndTime;
                    // Allow small variance for fees (0.01) if needed, or exact match
                    const isAmountMatch = Math.abs(tx.value - expectedAmount) < 0.001;
                    return isRecent && isAmountMatch;
                });

                if (match) {
                    this.processedTxIds.add(match.hash);
                    await this.handlePayoutReceived(ticket, match);
                }
            }
        } catch (error) {
            logger.error('Payout check failed', { error: error.message });
        }
    }

    async handlePayoutReceived(ticket, tx) {
        logger.info('💰 Payout received!', { channelId: ticket.channelId, txId: tx.hash, amount: tx.value });

        // Update state
        ticket.transition(STATES.GAME_COMPLETE, {
            payoutTxId: tx.hash,
            payoutAmount: tx.value,
            payoutReceivedAt: Date.now()
        });
        saveState();

        // Notify channel
        try {
            const channel = await this.client.channels.fetch(ticket.channelId);
            if (channel) {
                await channelLock.acquire(ticket.channelId);
                await channel.send(`Payment received! (${tx.hash.substring(0, 10)}...). Vouching now.`);

                // Post vouch
                await postVouch(this.client, ticket);
            }
        } catch (error) {
            logger.error('Failed to notify payout', { channelId: ticket.channelId, error: error.message });
        }

        // Cleanup ticket from manager (it's now complete)
        // (TicketManager cleanup runs separately, but we can remove it from active tracking if needed)
        // STATES.GAME_COMPLETE tickets are handled by cleanupOldTickets
    }
}

const payoutMonitor = new PayoutMonitor();
module.exports = { PayoutMonitor, payoutMonitor };
