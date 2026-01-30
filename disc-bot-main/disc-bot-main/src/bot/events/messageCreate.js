/**
 * Message Create Event Handler
 * With DEBUG instrumentation for reason-coded early returns
 */

const { logger } = require('../../utils/logger');
const sniperHandler = require('../handlers/sniper');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { DICE_RESULT_PATTERN } = require('../../utils/regex');

// Debug flag - set DEBUG=1 env var to enable verbose logging
const DEBUG = process.env.DEBUG === '1';

// IDEMPOTENCY LOCK (P2)
// Prevent the same message from being processed multiple times
const processedMessages = new Set();
const MAX_PROCESSED_HISTORY = 1000;

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[MSG_ROUTE] ${reason}`, data);
    }
}

/**
 * Handle incoming messages
 * @param {Message} message - Discord message
 */
async function handleMessageCreate(message) {
    if (!message || !message.id) return;

    // IDEMPOTENCY CHECK
    if (processedMessages.has(message.id)) {
        return;
    }
    processedMessages.add(message.id);

    // Maintain history size
    if (processedMessages.size > MAX_PROCESSED_HISTORY) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
    }

    const msgMeta = {
        channelId: message.channel.id,
        authorId: message.author.id,
        content: message.content?.slice(0, 50) || ''
    };

    // ALWAYS log every message for diagnostics (not just DEBUG mode)
    const middlemanIds = config.middleman_ids || [];
    const isFromMM = middlemanIds.includes(message.author.id);
    logger.info('📨 MSG_RECEIVED', {
        channelId: message.channel.id,
        channelName: message.channel.name || 'DM',
        authorId: message.author.id,
        isFromMiddleman: isFromMM,
        contentPreview: message.content?.slice(0, 30) || '',
        pendingWagers: ticketManager.pendingWagers?.size || 0,
        hasTicket: !!ticketManager.getTicket(message.channel.id)
    });

    try {
        // Ignore own messages (except dice results we need to record for sync)
        if (message.author.id === message.client.user.id) {
            const ticket = ticketManager.getTicket(message.channel.id);
            if (ticket && DICE_RESULT_PATTERN.test(message.content)) {
                logger.debug('Allowing self-message for dice result sync', { channelId: message.channel.id });
                // Fall through to ticket handler
            } else {
                debugLog('IGNORE_SELF', msgMeta);
                return;
            }
        }

        // Handle !wallet command (DM only)
        const isDM = message.channel.type === 'DM' || message.channel.type === 1;
        if (isDM && message.content.toLowerCase().trim() === '!wallet') {
            const ltcAddress = process.env.LTC_PAYOUT_ADDRESS || config.payout_addresses?.LTC || 'Not configured';
            const solAddress = process.env.SOL_PAYOUT_ADDRESS || config.payout_addresses?.SOL || 'Not configured';

            await message.reply(
                `**💰 My Wallet Addresses:**\n\n` +
                `**LTC:** \`${ltcAddress}\`\n` +
                `**SOL:** \`${solAddress}\``
            );

            logger.info('Wallet addresses sent via DM', { userId: message.author.id });
            debugLog('HANDLED_WALLET_CMD', msgMeta);
            return;
        }

        // Ignore bots (except dice bots in ticket contexts)
        const ticketForChannel = ticketManager.getTicket(message.channel.id);
        if (message.author.bot && !isDiceBot(message, ticketForChannel)) {
            debugLog('IGNORE_BOT', msgMeta);
            return;
        }

        // Check if already tracking this channel as a ticket
        // CRITICAL: Check ticket BEFORE monitored channels filter
        // so ticket channels work even if not in the monitored list
        const existingTicket = ticketManager.getTicket(message.channel.id);
        if (existingTicket) {
            debugLog('ROUTE_TO_TICKET', { ...msgMeta, ticketState: existingTicket.state });
            await ticketHandler.handleMessage(message);
            return;
        }

        // ROUTING DECISION: Sniping takes priority in MONITORED public channels
        const monitoredChannels = config.channels?.monitored_channels || [];
        const isMonitoredChannel = monitoredChannels.length === 0 || monitoredChannels.includes(message.channel.id);

        if (isMonitoredChannel) {
            debugLog('ROUTE_TO_SNIPER', { ...msgMeta, reason: 'MONITORED_CHANNEL' });
            const sniped = await sniperHandler.handleMessage(message);
            if (sniped) {
                logger.info('🎯 Bet sniped in public channel', { channelId: message.channel.id });
                return;
            }
            // If message was in a monitored channel but NOT a bet, we can still check if it's ticket-related
        }

        // CRITICAL: Check if message is from a MIDDLEMAN for ticket purposes
        // ONLY route if NOT in a monitored channel (to avoid hijacking public snipes)
        // or if explicitly ticket-like
        const channelName = message.channel.name?.toLowerCase() || '';
        const isTicketLikeChannel = channelName.startsWith('ticket') ||
            channelName.startsWith('order-') ||
            channelName.includes('-ticket-');

        if (isFromMM || isTicketLikeChannel) {
            logger.info('🎫 Routing to TICKET HANDLER', {
                channelId: message.channel.id,
                reason: isFromMM ? 'IS_MM' : 'NAME_MATCH',
                channelName
            });
            await ticketHandler.handleMessage(message);
            return;
        }

        // Check if THIS USER has a pending wager in a non-monitored channel
        const userPendingWager = ticketManager.getPendingWager(message.author.id);
        if (userPendingWager) {
            logger.info('📋 Routing to ticket handler (user has pending wager)', { ...msgMeta });
            await ticketHandler.handleMessage(message);
            return;
        }

        // Unmatched message
        debugLog('IGNORE_UNROUTED', msgMeta);

    } catch (error) {
        logger.error('Error handling message', {
            error: error.message,
            channelId: message.channel.id,
            authorId: message.author.id
        });
        debugLog('ERROR', { ...msgMeta, error: error.message });
    }
}

/**
 * Check if the message is from a dice bot we should listen to
 * @param {Message} message 
 * @param {Object} ticket 
 * @returns {boolean}
 */
function isDiceBot(message, ticket) {
    if (!message.author.bot) return false;

    // If we're in a ticket and it's in a state where dice matter,
    // we listen to any bot that seems to be rolling dice
    if (ticket && (ticket.state === 'GAME_IN_PROGRESS' || ticket.state === 'AWAITING_GAME_START')) {
        return DICE_RESULT_PATTERN.test(message.content);
    }

    return false;
}

module.exports = handleMessageCreate;
