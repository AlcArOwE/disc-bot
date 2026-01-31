/**
 * Sniper Handler - Detects bet offers and responds
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { extractBetAmounts } = require('../../utils/regex');
const { validateBetAmount } = require('../../utils/validator');
const { snipeDelay } = require('../../utils/delay');
const { logger } = require('../../utils/logger');
const { isUserInActiveTicket, ticketManager } = require('../../state/TicketManager');
const { logSnipe } = require('../../utils/notifier');
const { messageQueue } = require('../../utils/MessageQueue');

// GLOBAL SAFETY GATE (P1)
const MAX_BET_SAFETY_USD = config.payment_safety?.global_max_snipe_usd || 100;
const MIN_BET_SAFETY_USD = config.payment_safety?.min_bet_usd || 1;

// ANTI-RACE LOCK (P2)
const processingUsers = new Set();

/**
 * Handle incoming message for bet detection
 * @param {Message} message - Discord message
 * @returns {Promise<boolean>} - True if bet was sniped
 */
async function handleMessage(message) {
    // Don't respond to own messages
    if (message.author.id === message.client.user.id) {
        return false;
    }

    // Extract bet amounts from message
    const betData = extractBetAmounts(message.content);
    if (!betData) {
        return false;
    }

    logger.info('🔍 Bet detected - evaluating limits...', { userId: message.author.id, content: message.content });

    const opponentBet = betData.opponent;

    // Validate bet amount is within limits
    const validation = validateBetAmount(opponentBet);
    if (!validation.valid) {
        logger.info('⚠️ Bet ignored: Outside limits', {
            amount: opponentBet,
            reason: validation.reason,
            userId: message.author.id
        });
        return false;
    }

    // GLOBAL SAFETY CIRCUIT BREAKER
    const amountUsd = parseFloat(opponentBet);
    if (amountUsd > MAX_BET_SAFETY_USD) {
        logger.warn('🚨 Global Max Bet safety triggered! Blocking snipe.', { amountUsd, max: MAX_BET_SAFETY_USD });
        return false; // Changed from `return;` to `return false;` to match function signature
    }

    if (amountUsd < MIN_BET_SAFETY_USD) {
        logger.debug('Ignoring bet below minimum', { amountUsd, min: MIN_BET_SAFETY_USD });
        return false; // Changed from `return;` to `return false;` to match function signature
    }

    // Check if user is on cooldown or in active ticket
    const userId = message.author.id;
    if (isUserInActiveTicket(userId)) {
        logger.info('🚫 Bet ignored: User already in an active ticket', { userId });
        return false;
    }

    if (ticketManager.isOnCooldown(userId)) {
        logger.info('⏳ Bet ignored: User on cooldown', { userId });
        return false;
    }

    // Relaxed parallel check: 
    // Allow sniping if the user is NOT in an active ticket IN THIS CHANNEL
    // This allows one user to have multiple parallel tickets/games.
    const ticketInChannel = ticketManager.getTicket(message.channel.id);
    if (ticketInChannel && !ticketInChannel.isComplete()) {
        logger.debug('🚫 Bet ignored: Ticket already active in this channel', { userId, channelId: message.channel.id });
        return false;
    }

    // Calculate our bet with tax
    // My_Bet = Opponent_Bet + (Opponent_Bet * Tax_Rate)
    const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
    const ourBet = new BigNumber(opponentBet).times(taxMultiplier);

    // Format to 2 decimal places
    const ourBetFormatted = ourBet.toFixed(2);
    const opponentBetFormatted = new BigNumber(opponentBet).toFixed(2);

    // Build response from template
    const response = config.response_templates.bet_offer
        .replace('{calculated}', `$${ourBetFormatted}`)
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
        // CRITICAL: Set cooldown IMMEDIATELY to prevent duplicate snipes during delay
        ticketManager.setCooldown(userId);

        // Show typing indicator immediately
        try {
            await message.channel.sendTyping();
        } catch (e) {
            // Ignore typing errors
        }

        // Human-like delay before responding (2 seconds - more natural)
        await snipeDelay();

        // Send response via rate-limited queue
        try {
            await messageQueue.send(message.channel, response, { replyTo: message });

            // CRITICAL: Store pending wager so when ticket channel is created,
            // we can link it with the correct bet amounts
            ticketManager.storePendingWager(
                userId,
                parseFloat(opponentBetFormatted),
                parseFloat(ourBetFormatted),
                message.channel.id,
                message.author.username
            );

            logger.info('Bet sniped successfully', {
                channelId: message.channel.id,
                userId: userId,
                response
            });

            // Log to webhook
            logSnipe(message.channel.id, userId, opponentBetFormatted, ourBetFormatted);

            return true;
        } catch (error) {
            logger.error('Failed to send snipe response', {
                error: error.message,
                channelId: message.channel.id
            });
            return false;
        }
    } finally {
        // Release lock
        processingUsers.delete(userId);
    }
}

/**
 * Check if message looks like a bet offer
 * @param {string} content - Message content
 * @returns {boolean}
 */
function isBetOffer(content) {
    return extractBetAmounts(content) !== null;
}

/**
 * Calculate our bet from opponent's bet
 * @param {number} opponentBet - Opponent's bet amount
 * @returns {string} - Our bet amount formatted
 */
function calculateOurBet(opponentBet) {
    const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
    return new BigNumber(opponentBet).times(taxMultiplier).toFixed(2);
}

module.exports = {
    handleMessage,
    isBetOffer,
    calculateOurBet
};
