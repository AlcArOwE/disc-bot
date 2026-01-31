/**
 * Sniper Handler - Detects and responds to bet offers in public channels
 */

const { extractBetAmounts } = require('../../utils/regex');
const { ticketManager } = require('../../state/TicketManager');
const { logger } = require('../../utils/logger');
const { logSnipe } = require('../../utils/notifier');
const { messageQueue } = require('../../utils/MessageQueue');
const config = require('../../../config.json');

// IS_VERIFICATION flag to disable delays during simulation
const IS_VERIFICATION = process.env.IS_VERIFICATION === 'true';

// Set of user IDs currently being processed to prevent concurrent overlapping snipes for the same user
const processingUsers = new Set();

/**
 * Handle a message in a potential sniping context
 * @param {Message} message - Discord message 
 * @returns {Promise<boolean>} - True if a snipe was attempted
 */
async function handleMessage(message) {
    const content = message.content;
    const userId = message.author.id;

    // 1. REGEX MATCHING (A1)
    const betData = extractBetAmounts(content);
    if (!betData) return false;

    // 1b. BET LIMIT CHECK
    const maxAllowed = config.payment_safety?.global_max_snipe_usd || config.betting_limits?.max || 35;
    if (betData.opponent > maxAllowed) {
        logger.debug('Ignoring bet: Exceeds max allowed', {
            amount: betData.opponent,
            maxAllowed
        });
        return false;
    }

    // 2. SELF-DETECTION (P1)
    if (userId === message.client.user.id) return false;

    // 3. COOLDOWN CHECK (P2)
    if (ticketManager.isOnCooldown(userId)) {
        logger.debug('Ignoring bet: User on cooldown', { userId });
        return false;
    }

    // 4. TAX CALCULATION (A2)
    const opponentBet = betData.opponent;
    const taxPercentage = config.tax_percentage || 0.05;
    const ourBet = opponentBet * (1 + taxPercentage);

    // Format for display
    const opponentBetFormatted = opponentBet.toFixed(2);
    const ourBetFormatted = ourBet.toFixed(2);

    // 5. RESPONSE GENERATION (A3)
    const response = (config.response_templates.bet_offer || config.response_templates.bet_response)
        .replace('{calculated}', `$${ourBetFormatted}`)
        .replace('{our_bet}', `$${ourBetFormatted}`)
        .replace('{base}', `$${opponentBetFormatted}`);

    logger.info('Sniping bet', {
        channelId: message.channel.id,
        userId: userId,
        opponentBet: opponentBetFormatted,
        ourBet: ourBetFormatted
    });

    // ATOMIC SNIPE LOCK (P2)
    if (processingUsers.has(userId)) {
        logger.info('🔒 Bet ignored: Atomic sniper lock active', { userId });
        return false;
    }
    processingUsers.add(userId);

    try {
        // 6. CRITICAL: Set cooldown IMMEDIATELY
        ticketManager.setCooldown(userId);

        // 7. PRE-FLIGHT STORAGE: Store pending wager BEFORE any delays or network calls
        // This ensures the voucher data is available as soon as a ticket channel opens.
        ticketManager.storePendingWager(
            userId,
            parseFloat(opponentBetFormatted),
            parseFloat(ourBetFormatted),
            message.channel.id,
            message.author.username
        );

        // Show typing indicator
        try {
            await message.channel.sendTyping();
        } catch (e) { }

        // 8. DELAY (Verified bypass during simulation)
        if (!IS_VERIFICATION) {
            const delay = 1500 + Math.random() * 1500;
            await new Promise(r => setTimeout(r, delay));
        }

        // 9. OUTBOUND QUEUE (R3)
        await messageQueue.send(message.channel, response, { replyTo: message });

        logger.info('Bet sniped successfully', {
            channelId: message.channel.id,
            userId: userId,
            response
        });

        // Log to webhook
        logSnipe(message.channel.id, userId, opponentBetFormatted, ourBetFormatted);

        return true;
    } catch (error) {
        logger.error('Failed to execute snipe', { error: error.message, userId });
        return false;
    } finally {
        processingUsers.delete(userId);
    }
}

module.exports = {
    handleMessage
};
