/**
 * Ticket Watchdog - Proactively detects and recovers from game stalls
 */

const { logger } = require('../utils/logger');
const { ticketManager } = require('./TicketManager');
const { STATES } = require('./StateMachine');
const config = require('../../config.json');
const { messageQueue } = require('../utils/MessageQueue');

class TicketWatchdog {
    constructor(client) {
        this.client = client;
        this.interval = null;
        this.STALL_THRESHOLD_MS = 60000; // 60 seconds
        this.MAX_RECOVERY_ATTEMPTS = 3;
        this.recoveryAttempts = new Map(); // channelId -> count
    }

    start() {
        if (this.interval) return;
        logger.info('🐕 TICKET_WATCHDOG_STARTED');
        this.interval = setInterval(() => this.checkTickets(), 30000); // Check every 30s
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async checkTickets() {
        const activeTickets = ticketManager.getActiveTickets();
        const now = Date.now();

        for (const ticket of activeTickets) {
            const idleTime = now - ticket.updatedAt;
            if (idleTime < this.STALL_THRESHOLD_MS) continue;

            // Don't recovery if it's already cancelled or complete
            if (ticket.isComplete()) continue;

            const attempts = this.recoveryAttempts.get(ticket.channelId) || 0;
            if (attempts >= this.MAX_RECOVERY_ATTEMPTS) {
                logger.warn('🚫 WATCHDOG_MAX_ATTEMPTS_REACHED', { channelId: ticket.channelId, state: ticket.state });
                continue;
            }

            await this.attemptRecovery(ticket);
            this.recoveryAttempts.set(ticket.channelId, attempts + 1);
        }
    }

    async attemptRecovery(ticket) {
        const channelId = ticket.channelId;
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) return;

            logger.info('🐕 WATCHDOG_RECOVERY_TRIGGERED', { channelId, state: ticket.state });

            switch (ticket.state) {
                case STATES.AWAITING_MIDDLEMAN:
                    // If we have terms but no MM response
                    if (ticket.data.opponentBet > 0) {
                        // await messageQueue.send(channel, "Waiting for middleman...");
                    }
                    break;

                case STATES.WAITING_FOR_OPPONENT_CONFIRM:
                    await messageQueue.send(channel, `Awaiting confirmation for **$${ticket.data.opponentBet} vs $${ticket.data.ourBet}**. Type **confirm**.`);
                    break;

                case STATES.AWAITING_PAYMENT_ADDRESS:
                    await messageQueue.send(channel, "Ready to pay. Drop address when ready!");
                    break;

                case STATES.WAITING_FOR_GAME_START:
                case STATES.AWAITING_GAME_START:
                    await messageQueue.send(channel, "Ready? Start the game!");
                    break;

                case STATES.WAITING_FOR_OUR_TURN:
                case STATES.ROLL_SENT:
                case STATES.WAITING_FOR_RESULT:
                case STATES.GAME_IN_PROGRESS:
                    // Critical game stall: Re-roll or ask
                    await this.recoverGame(channel, ticket);
                    break;
            }
        } catch (e) {
            logger.error('Watchdog recovery failed', { channelId, error: e.message });
        }
    }

    async asyncRecoverGame(channel, ticket) {
        const tracker = ticketManager.gameTrackers.get(ticket.channelId);
        if (!tracker) return;

        // If we rolled but no result, maybe the bot missed its own roll or the dice bot is slow
        if (tracker.lastBotRoll && !tracker.lastOpponentRoll) {
            await messageQueue.send(channel, "Opponent, your turn! Roll now.");
        } else if (!tracker.lastBotRoll) {
            // Re-roll if we haven't rolled
            logger.info('🐕 WATCHDOG_FORCING_REROLL', { channelId: ticket.channelId });
            await messageQueue.send(channel, config.game_settings.dice_command || '-roll');
        }
    }

    // Alias for the retry logic
    async recoverGame(channel, ticket) {
        return this.asyncRecoverGame(channel, ticket);
    }
}

module.exports = TicketWatchdog;
