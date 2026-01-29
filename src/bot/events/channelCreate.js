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
        // We don't know the opponent yet, but we can start tracking
        const existingTicket = ticketManager.getTicket(channel.id);
        if (!existingTicket) {
            const ticket = ticketManager.createTicket(channel.id, {
                opponentId: null,
                opponentBet: 0,
                ourBet: 0,
                autoDetected: true
            });

            // Skip to AWAITING_MIDDLEMAN since this is a new ticket
            ticket.transition(STATES.AWAITING_MIDDLEMAN);
            saveState();

            logger.info('🎫 Ticket auto-created for new channel', {
                channelId: channel.id,
                state: ticket.getState()
            });
        }

    } catch (error) {
        logger.error('Error handling channel create', {
            error: error.message,
            channelId: channel.id
        });
    }
}

module.exports = handleChannelCreate;
