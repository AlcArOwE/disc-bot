/**
 * Payout Monitor - Scans for incoming payouts for won games
 */
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { logger } = require('../../utils/logger');
const { saveState } = require('../../state/persistence');
const { getRecentTransactions } = require('../../crypto');

class PayoutMonitor {
    constructor() {
        this.interval = null;
        this.processedTxIds = new Set();
        this.scanInterval = 60000; // 60 seconds (safe for BlockCypher rate limits)
        this.client = null;
    }

    start(client) {
        if (this.interval) return;
        this.client = client;

        logger.info('Starting PayoutMonitor...');
        this.interval = setInterval(() => this.checkPayouts(), this.scanInterval);
        this.checkPayouts();
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async checkPayouts() {
        try {
            // Get all tickets waiting for payout
            const activeTickets = ticketManager.getActiveTickets();
            const waitingTickets = activeTickets.filter(t => t.state === STATES.AWAITING_PAYOUT);

            if (waitingTickets.length === 0) return;

            // Fetch recent transactions
            const transactions = await getRecentTransactions(20); // Check last 20

            if (!transactions || transactions.length === 0) return;

            for (const ticket of waitingTickets) {
                // Logic: In a Middleman setup, the middleman holds the Pot (OpponentBet + OurBet).
                // If we win, the middleman sends the Pot to us.
                // We assume the payout is roughly OpponentBet + OurBet (minus potential fees).
                // Even if P2P (loser pays), the bot sends its bet to middleman first (AWAITING_PAYOUT assumes winnings come in).
                // In P2P without middleman holding funds, this logic would need to change to expect OpponentBet only.
                // Given the bot sends funds to "Middleman" in AWAITING_PAYOUT -> PAYMENT_SENT flow,
                // we assume Middleman sends TOTAL POT back.
                const expectedAmount = (ticket.data.opponentBet || 0) + (ticket.data.ourBet || 0);

                // Find matching transaction
                // Match amount (allow small difference for fees? 5%?)
                const match = transactions.find(tx => {
                    if (this.processedTxIds.has(tx.txId)) return false;

                    // Check if tx is newer than when we started waiting (ticket.updatedAt)
                    // Allow some clock skew (e.g. 1 minute before)
                    if (tx.timestamp < (ticket.updatedAt - 60000)) return false;

                    // Check if amount is close enough
                    const diff = Math.abs(tx.amount - expectedAmount);
                    const percentDiff = diff / expectedAmount;

                    return percentDiff <= 0.05; // 5% tolerance
                });

                if (match) {
                    logger.info('Payout verified!', {
                        channelId: ticket.channelId,
                        txId: match.txId,
                        amount: match.amount,
                        expected: expectedAmount
                    });

                    this.processedTxIds.add(match.txId);

                    ticket.transition(STATES.GAME_COMPLETE, {
                        payoutTxId: match.txId,
                        payoutAmount: match.amount
                    });

                    saveState();

                    // Notify Channel and Vouch
                    if (this.client) {
                        try {
                            const channel = await this.client.channels.fetch(ticket.channelId);
                            if (channel) {
                                await channel.send(`✅ Payment verified! TXID: ${match.txId}`);

                                // Post Vouch
                                // Dynamic require to avoid circular dependency issues at load time
                                const { postVouch } = require('../handlers/ticket');
                                await new Promise(r => setTimeout(r, 2000)); // Delay before vouch
                                await postVouch(this.client, ticket);
                            }
                        } catch (err) {
                            logger.error('Failed to notify/vouch in PayoutMonitor', { error: err.message });
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('PayoutMonitor error', { error: error.message });
        }
    }
}

const payoutMonitor = new PayoutMonitor();
module.exports = { PayoutMonitor, payoutMonitor };
