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
const { calculateOurBet } = require('../../utils/betting');

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
    const ourBetFormatted = calculateOurBet(opponentBet);
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

        // NOTE: We do NOT create a ticket here anymore.
        // We wait for the actual ticket channel to be created (by the server bot)
        // and then latch onto it in ticket.js (handleChannelCreate / handlePotentialNewTicket).
        // This prevents the bot from treating the main wager channel as a ticket context.

        logger.info('Bet sniped successfully, waiting for ticket', {
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

module.exports = {
    handleMessage,
    isBetOffer
};
