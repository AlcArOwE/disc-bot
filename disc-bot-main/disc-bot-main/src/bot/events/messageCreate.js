/**
 * Message Create Event Handler
 * REWRITE: Bulletproof deduplication and routing
 */

const { logger } = require('../../utils/logger');
const sniperHandler = require('../handlers/sniper');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { DICE_RESULT_PATTERN } = require('../../utils/regex');
const { classifyChannel, ChannelType } = require('../../utils/channelClassifier');

const DEBUG = process.env.DEBUG === '1';

// INVARIANT 1: Exactly-once processing with TTL (30 minute expiry)
const processedMessages = new Map(); // messageId -> timestamp
const MESSAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes

// Periodic cleanup of expired message IDs
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [msgId, timestamp] of processedMessages) {
        if (now - timestamp > MESSAGE_TTL_MS) {
            processedMessages.delete(msgId);
            cleaned++;
        }
    }
    if (cleaned > 0 && DEBUG) {
        logger.debug(`[DEDUPE_CLEANUP] Removed ${cleaned} expired message IDs`);
    }
}, CLEANUP_INTERVAL_MS);

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[${reason}]`, data);
    }
}

/**
 * MESSAGE_IN log for every inbound message
 */
function logMessageIn(message) {
    if (DEBUG) {
        logger.debug('[MESSAGE_IN]', {
            messageId: message.id,
            channelId: message.channel.id,
            authorId: message.author.id,
            contentPreview: message.content?.slice(0, 30) || '',
            timestamp: Date.now()
        });
    }
}

/**
 * Log routing decision
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

    // MESSAGE_IN log (per spec)
    logMessageIn(message);

    const messageId = message.id;
    const channelId = message.channel.id;
    const authorId = message.author.id;

    // ═══════════════════════════════════════════════════════════════════════
    // INVARIANT 1: EXACTLY-ONCE PROCESSING (TTL-based)
    // ═══════════════════════════════════════════════════════════════════════
    if (processedMessages.has(messageId)) {
        debugLog('IGNORE_DUPLICATE_MESSAGE_ID', { messageId });
        return;
    }
    // Mark as processed IMMEDIATELY before any async work
    processedMessages.set(messageId, Date.now());

    try {
        const channelClass = classifyChannel(message.channel);

        // ═══════════════════════════════════════════════════════════════════
        // EARLY FILTERS (All logged with reason codes)
        // ═══════════════════════════════════════════════════════════════════

        // IGNORE_SELF (except own dice results in tickets)
        if (authorId === message.client.user.id) {
            const ticket = ticketManager.getTicket(channelId);
            if (ticket && DICE_RESULT_PATTERN.test(message.content)) {
                // Allow own dice results to sync game state
            } else {
                debugLog('IGNORE_SELF', { messageId });
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
            debugLog('IGNORE_EXCLUDED', { messageId, channelId });
            return;
        }

        // IGNORE_BOT (except dice bots in active game tickets)
        const existingTicket = ticketManager.getTicket(channelId);
        if (message.author.bot) {
            if (isDiceBot(message, existingTicket)) {
                debugLog('PROCESS_DICE_BOT', { messageId, authorId });
            } else {
                debugLog('IGNORE_BOT', { messageId, authorId });
                return;
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // ROUTING (Priority order)
        // ═══════════════════════════════════════════════════════════════════

        // Priority 1: Existing Ticket
        if (existingTicket) {
            logRoutingDecision(message, 'TICKET_HANDLER', 'Routing to active session');
            await ticketHandler.handleMessage(message);
            return;
        }

        // Priority 2: Public Sniping
        if (channelClass.type === ChannelType.PUBLIC && channelClass.allowSnipe) {
            const sniped = await sniperHandler.handleMessage(message);
            if (sniped) {
                logRoutingDecision(message, 'SNIPED', 'New bet detected');
            } else {
                debugLog('IGNORE_NO_MATCH', { messageId, channelId });
            }
            return;
        }

        // Priority 3: Potential Ticket Trigger
        if (channelClass.type === ChannelType.TICKET) {
            const handled = await ticketHandler.handleMessage(message);
            if (handled) {
                logRoutingDecision(message, 'TICKET_INIT', 'New ticket channel matched');
            } else {
                debugLog('IGNORE_UNHANDLED_TICKET', { messageId, channelId });
            }
            return;
        }

        // Default: Unrouted
        debugLog('IGNORE_WRONG_CHANNEL', { messageId, channelId, type: channelClass.type });

    } catch (error) {
        logger.error('[IGNORE_INTERNAL_ERROR]', {
            messageId,
            error: error.message,
            channelId,
            authorId
        });
    }
}

/**
 * Check if the message is from a dice bot we should listen to
 */
function isDiceBot(message, ticket) {
    if (!message.author.bot) return false;
    if (ticket && (ticket.state === 'GAME_IN_PROGRESS' || ticket.state === 'AWAITING_GAME_START')) {
        return DICE_RESULT_PATTERN.test(message.content);
    }
    return false;
}

module.exports = handleMessageCreate;
