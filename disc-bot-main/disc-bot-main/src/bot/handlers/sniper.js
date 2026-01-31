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

        // 6. STORE PENDING WAGER (before any delays)
        ticketManager.storePendingWager(
            userId,
            parseFloat(opponentBetFormatted),
            parseFloat(ourBetFormatted),
            message.channel.id,
            message.author.username
        );

        // 7. GENERATE RESPONSE
        const response = (config.response_templates.bet_offer || config.response_templates.bet_response)
            .replace('{calculated}', `$${ourBetFormatted}`)
            .replace('{our_bet}', `$${ourBetFormatted}`)
            .replace('{base}', `$${opponentBetFormatted}`);

        logger.info('[SNIPE_MATCHED]', {
            messageId,
            matchType: 'bet',
            extractedBet: opponentBetFormatted,
            snipeId: `${userId}-${Date.now()}`
        });

        // 8. TYPING INDICATOR (non-blocking)
        try {
            await message.channel.sendTyping();
        } catch (e) { /* ignore */ }

        // ═══════════════════════════════════════════════════════════════════
        // INVARIANT B: ENFORCE MINIMUM 2000ms DELAY BEFORE RESPONSE
        // Check IS_VERIFICATION at RUNTIME (not module load)
        // ═══════════════════════════════════════════════════════════════════
        const isVerificationMode = process.env.IS_VERIFICATION === 'true';
        if (!isVerificationMode) {
            const elapsed = Date.now() - startTime;
            const remainingDelay = Math.max(0, MIN_RESPONSE_DELAY_MS - elapsed);

            // Add slight randomization (2000-3000ms total from start)
            const totalDelay = remainingDelay + Math.floor(Math.random() * 1000);

            if (totalDelay > 0) {
                debugLog('RESPONSE_DELAY', { messageId, delayMs: totalDelay });
                await new Promise(r => setTimeout(r, totalDelay));
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
