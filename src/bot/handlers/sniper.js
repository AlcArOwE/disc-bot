/**
 * Sniper Handler - Detects bet offers and responds
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { extractBetAmounts } = require('../../utils/regex');
const { validateBetAmount } = require('../../utils/validator');
const { humanDelay } = require('../../utils/delay');
const { logger } = require('../../utils/logger');
const { ticketManager } = require('../../state/TicketManager');
const { logSnipe } = require('../../utils/notifier');

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

    const opponentBet = betData.opponent;

    // Validate bet amount is within limits
    const validation = validateBetAmount(opponentBet);
    if (!validation.valid) {
        logger.debug('Bet outside limits', {
            amount: opponentBet,
            reason: validation.reason,
            userId: message.author.id
        });
        return false;
    }

    // Check if user is on cooldown or in active ticket
    const userId = message.author.id;
    if (ticketManager.isOnCooldown(userId)) {
        logger.debug('User on cooldown', { userId });
        return false;
    }

    if (ticketManager.isUserInActiveTicket(userId)) {
        logger.debug('User in active ticket', { userId });
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

    // CRITICAL: Set cooldown IMMEDIATELY to prevent duplicate snipes during delay
    ticketManager.setCooldown(userId);

    // Check permissions
    // If we're not in a guild (DM), we generally have permissions.
    // If in a guild, check if we can send messages.
    if (message.guild && message.channel.permissionsFor(message.client.user) &&
        !message.channel.permissionsFor(message.client.user).has('SEND_MESSAGES')) {
        logger.warn('Missing permissions to snipe in channel', { channelId: message.channel.id });
        return false;
    }

    // Show typing indicator immediately
    try {
        await message.channel.sendTyping();
    } catch (e) {
        // Ignore typing errors (can happen if perm is missing but cached perm says yes, or rate limits)
        logger.debug('Failed to send typing', { error: e.message });
    }

    // Human-like delay before responding
    await humanDelay(response);

    // Send response
    try {
        await message.reply(response);

        // CRITICAL: Create a ticket to track this bet through the payment workflow
        const ticketHandler = require('./ticket');
        ticketHandler.createTicket(
            message.channel.id,
            userId,
            parseFloat(opponentBetFormatted),
            parseFloat(ourBetFormatted)
        );

        logger.info('Bet sniped successfully, ticket created', {
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
