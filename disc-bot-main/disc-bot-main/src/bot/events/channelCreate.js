/**
 * Channel Create Event Handler
 * Detects when new ticket channels are created and auto-tracks them
 */

const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');

/**
 * Handle new channel creation
 * @param {Channel} channel - Discord channel
 */
async function handleChannelCreate(channel) {
    try {
        // Check if this looks like a ticket channel
        const channelName = channel.name?.toLowerCase() || '';

        // Common ticket channel patterns
        const isTicketChannel =
            channelName.includes('ticket') ||
            channelName.includes('order') ||
            channelName.includes('wager') ||
            channelName.includes('bet');

        if (!isTicketChannel) {
            return;
        }

        logger.info('🎫 New ticket channel detected!', {
            channelId: channel.id,
            channelName: channel.name
        });

        // Create a ticket for this channel and put it in AWAITING_MIDDLEMAN state
        // Try to link with a pending wager from a recent snipe
        const existingTicket = ticketManager.getTicket(channel.id);
        if (!existingTicket) {
            // Try to get pending wager (most recent unexpired one)
            const pendingWager = ticketManager.getAnyPendingWager();

            let ticketData;
            if (pendingWager) {
                // We have bet info from a recent snipe!
                ticketData = {
                    opponentId: pendingWager.userId,
                    opponentBet: pendingWager.opponentBet,
                    ourBet: pendingWager.ourBet,
                    sourceChannelId: pendingWager.sourceChannelId,
                    autoDetected: true
                };
                logger.info('🎫 Linked ticket to pending wager', {
                    channelId: channel.id,
                    opponentId: pendingWager.userId,
                    opponentBet: pendingWager.opponentBet,
                    ourBet: pendingWager.ourBet
                });
            } else {
                // No pending wager - create with empty data (will need to be filled later)
                ticketData = {
                    opponentId: null,
                    opponentBet: 0,
                    ourBet: 0,
                    autoDetected: true
                };
                logger.warn('🎫 No pending wager found for new ticket', {
                    channelId: channel.id
                });
            }

            const ticket = ticketManager.createTicket(channel.id, ticketData);

            // Skip to AWAITING_MIDDLEMAN since this is a new ticket
            ticket.transition(STATES.AWAITING_MIDDLEMAN);
            saveState();

            logger.info('🎫 Ticket auto-created for new channel', {
                channelId: channel.id,
                state: ticket.getState(),
                hasBetInfo: !!pendingWager
            });

            // DEBUG: Print to console so user can see
            if (process.env.DEBUG === '1') {
                logger.debug('[CHANNEL_CREATE] Auto-ticket created', {
                    channelId: channel.id,
                    channelName: channel.name,
                    ticketState: ticket.getState(),
                    ticketData: ticket.data
                });
            }
        }

    } catch (error) {
        logger.error('Error handling channel create', {
            error: error.message,
            channelId: channel.id
        });
    }
}

module.exports = handleChannelCreate;
