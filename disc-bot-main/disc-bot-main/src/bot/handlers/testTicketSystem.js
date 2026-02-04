const { logger } = require('../../utils/logger');
const config = require('../../../config.json');

const MIDDLEMAN_ROLE_ID = "1467864454199775455";
const TICKETS_CATEGORY_ID = "1467864469701922900";
const BET_MARKET_CHANNEL_ID = "1467864467499909202";

/**
 * Handle messages in #bet-market for test ticket creation
 */
async function handleBetMarketMessage(message) {
    if (message.channel.id !== BET_MARKET_CHANNEL_ID) return false;
    // For simulation, allow self-messages to trigger tickets
    const isSelf = message.author.id === message.client.user.id;
    if (message.author.bot && !isSelf) return false;

    const content = message.content.trim().toLowerCase();

    // Check if it's a claim command from a middleman
    if (content.startsWith('!claim')) {
        // Broadened for simulation: check roles if member exists, otherwise allow if self
        const isMiddleman = message.member ? message.member.roles.cache.has(MIDDLEMAN_ROLE_ID) : isSelf;
        if (!isMiddleman && !isSelf) {
            await message.reply("Only middlemen can claim bets in this test environment.");
            return true;
        }

        // Parse opponent (last mentioned user or the one who posted the bet)
        // For simplicity in testing, we'll assume the middleman mentions the opponent
        const opponent = message.mentions.users.first();
        if (!opponent) {
            await message.reply("Usage: `!claim @opponent` (Mention the player you are claiming for)");
            return true;
        }

        try {
            await createTestTicket(message.guild, message.author, opponent, message.client.user);
            await message.react('✅');
        } catch (error) {
            logger.error('Failed to create test ticket', { error: error.message });
            await message.reply("Failed to create ticket channel.");
        }
        return true;
    }

    return false;
}

/**
 * Create a private ticket channel
 */
async function createTestTicket(guild, middleman, opponent, bot) {
    const ticketId = Math.random().toString(36).substring(7);
    const channelName = `ticket-${ticketId}`;

    logger.info('Creating test ticket channel', { channelName, middleman: middleman.tag, opponent: opponent.tag });

    const channel = await guild.channels.create(channelName, {
        type: 'GUILD_TEXT',
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
            { id: guild.id, deny: ['VIEW_CHANNEL'] },
            { id: middleman.id, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY'] },
            { id: opponent.id, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY'] },
            { id: bot.id, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY'] }
        ]
    });

    // Simulate Dyno Auto-Responder (Dahood Style)
    const welcomeEmbed = {
        title: "🎫 Support Ticket Opened",
        description: `Welcome to your wagering ticket! Staff will be with you shortly.\n\n**Escrow LTC Address:** \`LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ\`\n\nPlease state your bet terms (Amount vs Amount) to begin.`,
        color: 0x3498db, // Dyno Blue
        timestamp: new Date()
    };

    await channel.send({ embeds: [welcomeEmbed] });
    await channel.send(`Players: ${opponent} vs Spartan Autodicer\nMiddleman: ${middleman}`);

    return channel;
}

module.exports = {
    handleBetMarketMessage
};
