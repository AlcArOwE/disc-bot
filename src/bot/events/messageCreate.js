/**
 * Message Create Event Handler
 */

const { logger } = require('../../utils/logger');
const sniperHandler = require('../handlers/sniper');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');

/**
 * Handle incoming messages
 * @param {Message} message - Discord message
 */
async function handleMessageCreate(message) {
    try {
        // Ignore own messages
        if (message.author.id === message.client.user.id) {
            return;
        }

        // Handle !wallet command (DM only)
        // In selfbot-v13, DM type is 'DM' (string), not 1 (number)
        const isDM = message.channel.type === 'DM' || message.channel.type === 1;
        if (isDM && message.content.toLowerCase().trim() === '!wallet') {
            const ltcAddress = process.env.LTC_PAYOUT_ADDRESS || config.payout_addresses?.LTC || 'Not configured';
            const solAddress = process.env.SOL_PAYOUT_ADDRESS || config.payout_addresses?.SOL || 'Not configured';

            await message.reply(
                `**💰 My Wallet Addresses:**\n\n` +
                `**LTC:** \`${ltcAddress}\`\n` +
                `**SOL:** \`${solAddress}\``
            );

            logger.info('Wallet addresses sent via DM', { userId: message.author.id });
            return;
        }

        // Ignore bots (except dice bots we might be listening to)
        if (message.author.bot && !isDiceBot(message.author.id)) {
            return;
        }

        // Check if already tracking this channel as a ticket
        const existingTicket = ticketManager.getTicket(message.channel.id);
        if (existingTicket) {
            // Handle ticket message
            await ticketHandler.handleMessage(message);
            return;
        } else {
            // Fallback: Try to handle as a new ticket (auto-detection)
            const handled = await ticketHandler.handleMessage(message);
            if (handled) return;
        }

        // Check if channel is in monitored list (or monitor all if empty)
        const monitoredChannels = config.channels.monitored_channels || [];
        if (monitoredChannels.length > 0 && !monitoredChannels.includes(message.channel.id)) {
            return;
        }

        // Check for bet offers (sniper)
        const sniped = await sniperHandler.handleMessage(message);
        if (sniped) {
            logger.debug('Bet sniped in channel', { channelId: message.channel.id });
        }

    } catch (error) {
        logger.error('Error handling message', {
            error: error.message,
            channelId: message.channel.id,
            authorId: message.author.id
        });
    }
}

/**
 * Check if user ID is a known dice bot
 * @param {string} userId 
 * @returns {boolean}
 */
function isDiceBot(userId) {
    // Add known dice bot IDs here if needed
    const diceBotIds = [];
    return diceBotIds.includes(userId);
}

module.exports = handleMessageCreate;
