/**
 * Message Create Event Handler
 * Phase 2 Rewrite: Clear routing with explicit channel classification
 */

const { logger } = require('../../utils/logger');
const sniperHandler = require('../handlers/sniper');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { DICE_RESULT_PATTERN } = require('../../utils/regex');
const { classifyChannel, ChannelType } = require('../../utils/channelClassifier');

// Debug flag - set DEBUG=1 env var to enable verbose logging
const DEBUG = process.env.DEBUG === '1';

// IDEMPOTENCY LOCK - Prevent duplicate message processing
const processedMessages = new Set();
const MAX_PROCESSED_HISTORY = 1000;

// ROUTING MUTEX - Prevent concurrent routing for same message
const routingInProgress = new Set();

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[MSG_ROUTE] ${reason}`, data);
    }
}

/**
 * Log routing decision for every message (Item #13)
 */
function logRoutingDecision(message, decision, reason) {
    logger.info(`🔀 ROUTING: ${decision}`, {
        channelId: message.channel.id,
        channelName: message.channel.name || 'DM',
        authorId: message.author.id,
        reason,
        contentPreview: message.content?.slice(0, 30) || ''
    });
}

/**
 * Handle incoming messages
 * @param {Message} message - Discord message
 */
async function handleMessageCreate(message) {
    if (!message || !message.id) return;

    const channelId = message.channel.id;
    const authorId = message.author.id;

    // 1. DEDUPE (Requirement F/P2)
    if (processedMessages.has(message.id)) {
        return; // Silent because it's a double-trigger of the same exact event
    }
    processedMessages.add(message.id);
    if (processedMessages.size > MAX_PROCESSED_HISTORY) {
        processedMessages.delete(processedMessages.values().next().value);
    }

    // 2. CHANNEL MUTEX (Requirement E/F)
    // Prevents race conditions where two messages in the same channel 
    // trigger state transitions simultaneously.
    if (routingInProgress.has(channelId)) {
        debugLog('IGNORE_MUTEX_LOCKED', { channelId });
        return;
    }
    routingInProgress.add(channelId);

    try {
        const channelClass = classifyChannel(message.channel);

        // 3. EARLY FILTERS (Logged with reason codes per Requirement F)

        // IGNORE_SELF
        if (authorId === message.client.user.id) {
            // Exceptions for dice results in tickets
            const ticket = ticketManager.getTicket(channelId);
            if (ticket && DICE_RESULT_PATTERN.test(message.content)) {
                // Allow own dice results to sync state
            } else {
                debugLog('IGNORE_SELF', { messageId: message.id });
                return;
            }
        }

        // Handle !wallet command (DM only)
        if (channelClass.type === ChannelType.DM && message.content.toLowerCase().trim() === '!wallet') {
            const ltcAddress = process.env.LTC_PAYOUT_ADDRESS || config.payout_addresses?.LTC || 'Not configured';
            const solAddress = process.env.SOL_PAYOUT_ADDRESS || config.payout_addresses?.SOL || 'Not configured';
            await message.reply(`**💰 My Wallet Addresses:**\n\n**LTC:** \`${ltcAddress}\`\n**SOL:** \`${solAddress}\``);
            logRoutingDecision(message, 'HANDLED', 'Wallet command in DM');
            return;
        }

        // IGNORE_EXCLUDED
        if (channelClass.type === ChannelType.EXCLUDED) {
            debugLog('IGNORE_EXCLUDED', { channelId });
            return;
        }

        // IGNORE_BOT (Except dice bots)
        const existingTicket = ticketManager.getTicket(channelId);
        if (message.author.bot) {
            if (isDiceBot(message, existingTicket)) {
                debugLog('PROCESS_DICE_BOT', { authorId });
            } else {
                debugLog('IGNORE_BOT', { authorId });
                return;
            }
        }

        // 4. ROUTING

        // Priority 1: Existing Ticket (Requirement B/E)
        if (existingTicket) {
            logRoutingDecision(message, 'TICKET_HANDLER', 'Routing to active session');
            await ticketHandler.handleMessage(message);
            return;
        }

        // Priority 2: Public Sniping (Requirement A)
        if (channelClass.type === ChannelType.PUBLIC && channelClass.allowSnipe) {
            const sniped = await sniperHandler.handleMessage(message);
            if (sniped) {
                logRoutingDecision(message, 'SNIPED', 'New bet detected');
            } else {
                debugLog('IGNORE_NOT_BET', { channelId });
            }
            return;
        }

        // Priority 3: Potential Ticket Trigger (Requirement B)
        if (channelClass.type === ChannelType.TICKET) {
            const handled = await ticketHandler.handleMessage(message);
            if (handled) {
                logRoutingDecision(message, 'TICKET_INIT', 'New ticket channel matched');
            } else {
                debugLog('IGNORE_UNHANDLED_TICKET', { channelId });
            }
            return;
        }

        // Default: Unrouted
        debugLog('IGNORE_UNROUTED', { channelId, type: channelClass.type });

    } catch (error) {
        logger.error('CRITICAL: Message routing failed', {
            error: error.message,
            channelId,
            authorId
        });
    } finally {
        routingInProgress.delete(channelId);
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
