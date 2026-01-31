/**
 * Channel Create Event Handler
 * Detects when new ticket channels are created and auto-tracks them
 */

const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');

// IDEMPOTENCY LOCK (P2)
const processedChannels = new Set();

/**
 * Handle new channel creation
 * @param {Channel} channel - Discord channel
 */
async function handleChannelCreate(channel) {
    // ═══════════════════════════════════════════════════════════════════════
    // FORENSIC: First line of handler - proves events fire
    // ═══════════════════════════════════════════════════════════════════════
    logger.info('🔥 HANDLER_FIRED: channelCreate', {
        channelId: channel?.id || 'NO_ID',
        channelName: channel?.name || 'NO_NAME',
        channelType: channel?.type || 'NO_TYPE'
    });

    if (!channel || !channel.id) return;

    // IDEMPOTENCY CHECK
    if (processedChannels.has(channel.id)) return;
    processedChannels.add(channel.id);

    // History cleanup
    if (processedChannels.size > 500) {
        const first = processedChannels.values().next().value;
        processedChannels.delete(first);
    }

    try {
        // Check if this looks like a ticket channel
        const channelName = channel.name?.toLowerCase() || '';

        // Unified ticket patterns
        const isTicketPattern =
            channelName.startsWith('ticket') ||
            channelName.startsWith('order-') ||
            channelName.includes('-ticket-');

        // SMART MATCHING: Try to get pending wager for EVERY new channel
        // This allows "any name" tickets to work if they match a recent wager
        const pendingWager = ticketManager.getAnyPendingWager(channel.name);

        // If it's not a ticket pattern AND no wager matches, ignore it
        if (!isTicketPattern && !pendingWager) {
            return;
        }

        logger.info('🎫 TICKET_DETECTED', {
            channelId: channel.id,
            channelName: channel.name,
            reason: isTicketPattern ? 'name_match' : 'wager_match'
        });

        const existingTicket = ticketManager.getTicket(channel.id);
        if (!existingTicket) {
            let ticketData;
            if (pendingWager) {
                // We have bet info from a recent snipe!
                ticketData = {
                    opponentId: pendingWager.userId,
                    opponentBet: pendingWager.opponentBet,
                    ourBet: pendingWager.ourBet,
                    sourceChannelId: pendingWager.sourceChannelId,
                    snipeId: pendingWager.snipeId, // TRACK SNIPE ID
                    autoDetected: true
                };
                logger.info('🎫 TICKET_LINKED', {
                    channelId: channel.id,
                    snipeId: pendingWager.snipeId,
                    opponentId: pendingWager.userId,
                    opponentBet: pendingWager.opponentBet
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
