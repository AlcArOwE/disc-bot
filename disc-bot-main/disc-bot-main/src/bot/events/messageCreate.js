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

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: IDEMPOTENCY - Prevent duplicate processing
    // ═══════════════════════════════════════════════════════════════════
    if (processedMessages.has(message.id)) {
        return;
    }
    processedMessages.add(message.id);

    // Maintain history size
    if (processedMessages.size > MAX_PROCESSED_HISTORY) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
    }

    // ROUTING MUTEX (Item #20)
    if (routingInProgress.has(message.id)) {
        debugLog('MUTEX_BLOCKED', { messageId: message.id });
        return;
    }
    routingInProgress.add(message.id);

    try {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: CHANNEL CLASSIFICATION (Items #11, #12)
        // ═══════════════════════════════════════════════════════════════════
        const channelClass = classifyChannel(message.channel);

        debugLog('CHANNEL_CLASSIFIED', {
            channelId: message.channel.id,
            type: channelClass.type,
            allowPayment: channelClass.allowPayment,
            allowSnipe: channelClass.allowSnipe
        });

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: EARLY FILTERS
        // ═══════════════════════════════════════════════════════════════════

        // Ignore own messages (except dice results)
        if (message.author.id === message.client.user.id) {
            const ticket = ticketManager.getTicket(message.channel.id);
            if (ticket && DICE_RESULT_PATTERN.test(message.content)) {
                // Fall through for dice sync
            } else {
                debugLog('IGNORE_SELF', { messageId: message.id });
                return;
            }
        }

        // Handle !wallet command (DM only)
        if (channelClass.type === ChannelType.DM && message.content.toLowerCase().trim() === '!wallet') {
            const ltcAddress = process.env.LTC_PAYOUT_ADDRESS || config.payout_addresses?.LTC || 'Not configured';
            const solAddress = process.env.SOL_PAYOUT_ADDRESS || config.payout_addresses?.SOL || 'Not configured';
            await message.reply(
                `**💰 My Wallet Addresses:**\n\n**LTC:** \`${ltcAddress}\`\n**SOL:** \`${solAddress}\``
            );
            logRoutingDecision(message, 'HANDLED', 'Wallet command in DM');
            return;
        }

        // Ignore excluded channels
        if (channelClass.type === ChannelType.EXCLUDED) {
            debugLog('IGNORE_EXCLUDED', { channelId: message.channel.id });
            return;
        }

        // Ignore bots (except dice bots in ticket contexts)
        const existingTicket = ticketManager.getTicket(message.channel.id);
        if (message.author.bot && !isDiceBot(message, existingTicket)) {
            debugLog('IGNORE_BOT', { authorId: message.author.id });
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: TICKET HANDLER - Existing tickets get priority
        // ═══════════════════════════════════════════════════════════════════
        if (existingTicket) {
            logRoutingDecision(message, 'TICKET_HANDLER', 'Existing ticket in channel');
            await ticketHandler.handleMessage(message);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: PUBLIC CHANNEL - Sniping ONLY (Item #15)
        // ═══════════════════════════════════════════════════════════════════
        if (channelClass.type === ChannelType.PUBLIC && channelClass.allowSnipe) {
            const sniped = await sniperHandler.handleMessage(message);
            if (sniped) {
                logRoutingDecision(message, 'SNIPED', 'Bet detected in public channel');
                return;
            }
            // Not a bet - ignore in public channels
            debugLog('IGNORE_NON_BET_PUBLIC', { channelId: message.channel.id });
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: TICKET CHANNEL - Route to ticket handler
        // ═══════════════════════════════════════════════════════════════════
        if (channelClass.type === ChannelType.TICKET) {
            logRoutingDecision(message, 'TICKET_HANDLER', 'Ticket channel by name');
            await ticketHandler.handleMessage(message);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: UNROUTED - No action
        // ═══════════════════════════════════════════════════════════════════
        debugLog('IGNORE_UNROUTED', {
            channelId: message.channel.id,
            channelType: channelClass.type
        });

    } catch (error) {
        logger.error('Error handling message', {
            error: error.message,
            channelId: message.channel.id,
            authorId: message.author.id
        });
    } finally {
        routingInProgress.delete(message.id);
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
