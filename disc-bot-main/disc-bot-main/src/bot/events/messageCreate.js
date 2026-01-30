/**
 * Message Create Event Handler
 * With DEBUG instrumentation for reason-coded early returns
 */

const { logger } = require('../../utils/logger');
const sniperHandler = require('../handlers/sniper');
const ticketHandler = require('../handlers/ticket');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');

// Debug flag - set DEBUG=1 env var to enable verbose logging
const DEBUG = process.env.DEBUG === '1';

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[MSG_ROUTE] ${reason}`, data);
    }
}

/**
 * Handle incoming messages
 * @param {Message} message - Discord message
 */
async function handleMessageCreate(message) {
    const msgMeta = {
        channelId: message.channel.id,
        authorId: message.author.id,
        content: message.content?.slice(0, 50) || ''
    };

    try {
        // Ignore own messages
        if (message.author.id === message.client.user.id) {
            debugLog('IGNORE_SELF', msgMeta);
            return;
        }

        // Handle !wallet command (DM only)
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
            debugLog('HANDLED_WALLET_CMD', msgMeta);
            return;
        }

        // Ignore bots (except dice bots we might be listening to)
        if (message.author.bot && !isDiceBot(message.author.id)) {
            debugLog('IGNORE_BOT', msgMeta);
            return;
        }

        // Check if already tracking this channel as a ticket
        const existingTicket = ticketManager.getTicket(message.channel.id);
        if (existingTicket) {
            debugLog('ROUTE_TO_TICKET', { ...msgMeta, ticketState: existingTicket.state });
            await ticketHandler.handleMessage(message);
            return;
        }

        // Check if channel is in monitored list (or monitor all if empty)
        const monitoredChannels = config.channels.monitored_channels || [];
        if (monitoredChannels.length > 0 && !monitoredChannels.includes(message.channel.id)) {
            debugLog('IGNORE_UNMONITORED', msgMeta);
            return;
        }

        // Check for bet offers (sniper)
        debugLog('ROUTE_TO_SNIPER', msgMeta);
        const sniped = await sniperHandler.handleMessage(message);
        if (sniped) {
            logger.info('Bet sniped in channel', { channelId: message.channel.id });
            debugLog('SNIPE_SUCCESS', msgMeta);
        } else {
            debugLog('SNIPE_NO_MATCH', msgMeta);
        }

    } catch (error) {
        logger.error('Error handling message', {
            error: error.message,
            channelId: message.channel.id,
            authorId: message.author.id
        });
        debugLog('ERROR', { ...msgMeta, error: error.message });
    }
}

/**
 * Check if user ID is a known dice bot
 * @param {string} userId 
 * @returns {boolean}
 */
function isDiceBot(userId) {
    const diceBotIds = [];
    return diceBotIds.includes(userId);
}

module.exports = handleMessageCreate;
