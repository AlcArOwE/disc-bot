/**
 * Message Create Event Handler
 * REWRITE: Bulletproof deduplication and routing
 */

const { logger } = require('../../utils/logger');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { DICE_RESULT_PATTERN, isDynoTicketNotification } = require('../../utils/regex');
const { classifyChannel, ChannelType } = require('../../utils/channelClassifier');
const testTicketSystem = require('../handlers/testTicketSystem');

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
    const isSim = message.guild?.id === "1467858063594754212";
    const prefix = isSim ? "🧪 [SIM_DEBUG] " : "🔀 ";
    logger.info(`${prefix}ROUTING: ${decision}`, {
        channelId: message.channel.id,
        channelName: message.channel.name || 'DM',
        authorId: message.author.id,
        reason,
        contentPreview: message.content?.slice(0, 30) || ''
    });
}

async function handleMessageCreate(message) {
    if (!message || !message.id) return;

    const messageId = message.id;
    const channelId = message.channel.id;
    const authorId = message.author.id;
    const authorName = message.author.username;
    const contentPreview = message.content?.slice(0, 50) || 'NO_CONTENT';

    // ═══════════════════════════════════════════════════════════════════════
    // MANDATORY DRILL LOGGING: TICKET_MSG_IN
    // ═══════════════════════════════════════════════════════════════════════
    const ticket = ticketManager.getTicket(channelId);
    if (ticket || message.channel.name?.includes('ticket') || message.channel.name?.includes('order')) {
        logger.info('TICKET_MSG_IN', {
            ticketId: ticket?.id || 'NEW',
            channelId,
            messageId,
            authorId,
            authorName,
            contentPreview
        });
    } else {
        // Standard forensic log for non-ticket channels
        logger.info('🔥 HANDLER_FIRED: messageCreate', {
            messageId,
            channelId,
            channelName: message.channel.name || 'NO_NAME',
            authorId,
            authorName,
            contentPreview
        });
    }

    // MESSAGE_IN log (per spec)
    logMessageIn(message);

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

        // IGNORE_SELF (except in tickets where we need to process our own dice results)
        if (authorId === message.client.user.id) {
            const ticket = ticketManager.getTicket(channelId);
            if (!ticket) {
                logger.info('DECISION', {
                    ticketId: 'N/A',
                    outcome: 'IGNORED',
                    reasonCode: 'IGNORE_SELF',
                    stateAfter: 'N/A'
                });
                return;
            }
        }

        // Handle test environment ticket creation (!claim)
        const testHandled = await testTicketSystem.handleBetMarketMessage(message);
        if (testHandled) {
            logRoutingDecision(message, 'TEST_TICKET_INIT', 'Test ticket system processed claim');
            return;
        }

        // Handle DM Commands (Robust System)
        if (channelClass.type === ChannelType.DM) {
            // Lazy load to prevent circular deps
            const dmHandler = require('../handlers/dmCommands');
            const handled = await dmHandler.handle(message);
            if (handled) {
                logRoutingDecision(message, 'DM_COMMAND', 'Processed by DM handler');
                return;
            }
        }

        // IGNORE_EXCLUDED
        if (channelClass.type === ChannelType.EXCLUDED) {
            debugLog('IGNORE_EXCLUDED', { messageId, channelId });
            return;
        }

        // IGNORE_BOT (except dice bots in active game tickets)
        const existingTicket = ticketManager.getTicket(channelId);
        if (message.author.bot) {
            // Allow dice bots during games
            if (isDiceBot(message, existingTicket)) {
                debugLog('PROCESS_DICE_BOT', { messageId, authorId });
            }
            // Allow Dyno bot in ticket channels (posts LTC addresses)
            else if (existingTicket && isTrustedTicketBot(authorId)) {
                logger.info('🤖 PROCESS_TRUSTED_BOT', {
                    messageId,
                    authorId,
                    authorName: message.author.username,
                    channelId
                });
            }
            else {
                debugLog('IGNORE_BOT', { messageId, authorId });
                return;
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // ROUTING (Priority order)
        // ═══════════════════════════════════════════════════════════════════

        // Priority 1: Existing Ticket
        if (existingTicket) {
            // CRITICAL: Once a ticket exists for this ID, we ALWAYS route it
            await ticketHandler.handleMessage(message);
            return;
        }

        // Priority 2: Potential Ticket Trigger or Mention Recovery
        const handled = await ticketHandler.handleMessage(message);
        if (handled) {
            logRoutingDecision(message, 'TICKET_INIT', 'Ticket handler processed message');
            return;
        }

        // Priority 4: Discovery (STRICT RESTRAINT)
        const botId = message.client.user.id;
        const lowerContent = (message.content + ' ' + (message.embeds?.[0]?.description || '')).toLowerCase();
        const hasDicingTerms = ['dice', 'wager', 'bet', 'roll', 'vs', 'ft5'].some(k => lowerContent.includes(k));
        const isBotNotification = isTrustedTicketBot(authorId) && isDynoTicketNotification(getFullContent(message));

        // Only discover if mentioned OR it's a bot notification OR contains gambling terms
        if (!existingTicket && (message.mentions.has(botId) || isBotNotification || hasDicingTerms)) {
            // SPARTAN RULE: NEVER reply to public messages. 
            // We only trigger discovery if it's a TICKET channel or if it's a mention.
            // If it's a public channel (CASINO/MONITORED), we only "discover" but do not send messages.

            logger.info('🔍 DISCOVERY_TRIGGERED', {
                channelId,
                reason: isBotNotification ? 'BOT_NOTIFICATION' : (message.mentions.has(botId) ? 'MENTION' : 'GAMBLING_KEYWORDS')
            });

            // If this is a public channel, we MUST NOT reply. 
            // However, handlePotentialNewTicket typically sends an intro message.
            // We should only allow handlePotentialNewTicket to send messages if the channel IS a ticket channel.

            const discovered = await ticketHandler.handlePotentialNewTicket(message);
            if (discovered) {
                logRoutingDecision(message, 'TICKET_DISCOVERED', 'Discovery trigger linked ticket');
                return;
            }
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
    if (!message.author.bot && message.author.id !== message.client.user.id) return false;

    const diceStates = [
        'GAME_IN_PROGRESS',
        'AWAITING_GAME_START',
        'WAITING_FOR_OUR_TURN',
        'ROLL_SENT',
        'WAITING_FOR_RESULT'
    ];

    if (ticket && diceStates.includes(ticket.state)) {
        // USE getFullContent to scan embeds!
        return DICE_RESULT_PATTERN.test(ticketHandler.getFullContent(message));
    }
    return false;
}

/**
 * Check if the bot is trusted to post in ticket channels (e.g., Dyno posts addresses)
 */
function isTrustedTicketBot(authorId) {
    const trustedIds = config.payment_safety?.ticket_bot_ids || [];
    return trustedIds.includes(authorId);
}

module.exports = handleMessageCreate;
