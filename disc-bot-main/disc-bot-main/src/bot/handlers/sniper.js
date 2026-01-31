/**
 * Sniper Handler - Detects and responds to bet offers in public channels
 * REWRITE: Atomic cooldown enforcement, guaranteed timing
 */

const { extractBetAmounts } = require('../../utils/regex');
const { ticketManager } = require('../../state/TicketManager');
const { logger } = require('../../utils/logger');
const { logSnipe } = require('../../utils/notifier');
const { messageQueue } = require('../../utils/MessageQueue');
const config = require('../../../config.json');

const IS_VERIFICATION = process.env.IS_VERIFICATION === 'true';
const DEBUG = process.env.DEBUG === '1';

// INVARIANT 2: Timing constants
const MIN_RESPONSE_DELAY_MS = 2000; // Minimum 2 seconds before response
const SNIPE_COOLDOWN_MS = config.bet_cooldown_ms || 8000; // 8 seconds between snipes per user

// Atomic processing lock per user (prevents race conditions)
const processingUsers = new Set();

// Initialize global state for humanization tracking
if (!global.lastSnipeMessage) global.lastSnipeMessage = "";

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[${reason}]`, data);
    }
}

/**
 * Handle a message in a potential sniping context
 * @param {Message} message - Discord message 
 * @returns {Promise<boolean>} - True if a snipe was attempted
 */
async function handleMessage(message) {
    // ═══════════════════════════════════════════════════════════════════════
    // FORENSIC: Sniper handler entry point
    // ═══════════════════════════════════════════════════════════════════════
    logger.info('🎯 SNIPER_REACHED', {
        messageId: message?.id,
        channelId: message?.channel?.id,
        authorId: message?.author?.id,
        contentPreview: message?.content?.slice(0, 40)
    });

    const content = message.content;
    const userId = message.author.id;
    const messageId = message.id;

    // 1. REGEX MATCHING
    const betData = extractBetAmounts(content);
    if (!betData) {
        return false;
    }

    // 2. BET LIMIT CHECK
    const maxAllowed = config.payment_safety?.global_max_snipe_usd || config.betting_limits?.max || 35;
    if (betData.opponent > maxAllowed) {
        debugLog('IGNORE_MAX_LIMIT', { messageId, amount: betData.opponent, maxAllowed });
        return false;
    }

    // 3. SELF-DETECTION
    if (userId === message.client.user.id) {
        return false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INVARIANT 2: ATOMIC COOLDOWN CHECK + SET (No race window)
    // ═══════════════════════════════════════════════════════════════════════

    // 4a. ATOMIC LOCK - Prevent concurrent processing for same user
    if (processingUsers.has(userId)) {
        debugLog('IGNORE_SNIPE_COOLDOWN', { messageId, userId, reason: 'processing_lock' });
        return false;
    }

    // 4b. COOLDOWN CHECK - Must be checked BEFORE acquiring lock
    if (ticketManager.isOnCooldown(userId)) {
        debugLog('IGNORE_SNIPE_COOLDOWN', { messageId, userId, reason: 'cooldown_active' });
        return false;
    }

    // 4c. ACQUIRE LOCK (atomic with cooldown set)
    processingUsers.add(userId);

    // 4d. SET COOLDOWN IMMEDIATELY (before any async work)
    ticketManager.setCooldown(userId, SNIPE_COOLDOWN_MS);

    const startTime = Date.now();

    try {
        // 5. CALCULATE BET
        const opponentBet = betData.opponent;
        const taxPercentage = config.tax_percentage || 0.05;
        const ourBet = opponentBet * (1 + taxPercentage);
        const opponentBetFormatted = opponentBet.toFixed(2);
        const ourBetFormatted = ourBet.toFixed(2);

        // 6. STORE PENDING WAGER (before any delays) with enhanced context
        const snipeId = `snipe-${userId}-${Date.now()}`;
        ticketManager.storePendingWager(
            userId,
            parseFloat(opponentBetFormatted),
            parseFloat(ourBetFormatted),
            message.channel.id,
            message.author.username,
            {
                snipeId, // STORE EXPLICIT ID
                messageId: message.id,
                guildId: message.guild?.id || null,
                betTermsRaw: content.substring(0, 50)
            }
        );

        // 7. GENERATE HUMANIZED RESPONSE (Phase 3)
        const templates = config.snipe_messages || [
            "i'll take this", "im in", "down for this", "I'm down", "bet",
            "taking this one", "I got this", "yea im in", "count me in",
            "lets go", "im game", "sure why not", "I'll take it", "down", "yo I'm in"
        ];

        // Randomization with no immediate repeat
        let selectedTemplate;
        const lastMsg = global.lastSnipeMessage || "";
        do {
            selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
        } while (selectedTemplate === lastMsg && templates.length > 1);
        global.lastSnipeMessage = selectedTemplate;

        // Apply natural casing variation
        const random = Math.random();
        if (random < 0.3) selectedTemplate = selectedTemplate.toLowerCase();
        else if (random < 0.6) selectedTemplate = selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1);

        const response = selectedTemplate
            .replace('{calculated}', `$${ourBetFormatted}`)
            .replace('{our_bet}', `$${ourBetFormatted}`)
            .replace('{base}', `$${opponentBetFormatted}`);

        logger.info('[SNIPE_MATCHED]', {
            messageId,
            matchType: 'bet',
            extractedBet: opponentBetFormatted,
            snipeId,
            template: selectedTemplate
        });

        // 8. TYPING INDICATOR (non-blocking)
        try {
            await message.channel.sendTyping();
        } catch (e) { /* ignore */ }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3: ENFORCE HUMANIZED 5s (+/- 0.5s) DELAY
        // ═══════════════════════════════════════════════════════════════════
        const isVerificationMode = process.env.IS_VERIFICATION === 'true';
        if (!isVerificationMode) {
            // Target delay: 5000ms +/- 500ms
            const targetDelay = 4500 + Math.floor(Math.random() * 1000);
            const elapsed = Date.now() - startTime;
            const remainingDelay = Math.max(0, targetDelay - elapsed);

            if (remainingDelay > 0) {
                debugLog('HUMANIZED_DELAY', { messageId, delayMs: remainingDelay });
                await new Promise(r => setTimeout(r, remainingDelay));
            }
        }

        // 9. SEND VIA GLOBAL QUEUE
        await messageQueue.send(message.channel, response, { replyTo: message });

        logger.info('[OUTBOUND_SEND_OK]', {
            messageId,
            correlationId: `snipe-${userId}`,
            elapsedMs: Date.now() - startTime
        });

        // 10. LOG TO WEBHOOK
        logSnipe(message.channel.id, userId, opponentBetFormatted, ourBetFormatted);

        return true;
    } catch (error) {
        logger.error('[OUTBOUND_SEND_ERR]', {
            messageId,
            correlationId: `snipe-${userId}`,
            errorClass: error.name,
            error: error.message
        });
        return false;
    } finally {
        // ALWAYS release lock
        processingUsers.delete(userId);
    }
}

module.exports = {
    handleMessage
};
