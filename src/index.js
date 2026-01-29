/**
 * Discord Wagering Bot - Main Entry Point
 * 
 * A sophisticated automated wagering bot that:
 * - Monitors Discord channels for bet offers (XvX format)
 * - Calculates tax (configured in config.json) and responds to valid bets
 * - Handles full ticket lifecycle with state machine
 * - Sends cryptocurrency payments automatically
 * - Plays first-to-5 dice games
 * - Posts vouches on wins
 * - Autonomously advertises and verifies payouts
 * 
 * WARNING: This is a self-bot which violates Discord TOS.
 * Use at your own risk.
 */

require('dotenv').config();

const { createClient } = require('./bot/client');
const handleReady = require('./bot/events/ready');
const handleMessageCreate = require('./bot/events/messageCreate');
const handleChannelCreate = require('./bot/events/channelCreate');
const { shutdown } = require('./state/persistence');
const { logger } = require('./utils/logger');

// Autonomous Components
const { autoAdvertiser } = require('./bot/AutoAdvertiser');
const { payoutMonitor } = require('./bot/monitors/PayoutMonitor');
const { staleTicketMonitor } = require('./bot/monitors/StaleTicketMonitor');

// Validate environment
if (!process.env.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN not set in .env file!');
    logger.error('Copy .env.example to .env and fill in your token.');
    process.exit(1);
}

// Create Discord client
const client = createClient();

// Register event handlers
client.on('ready', () => {
    handleReady(client);

    // Start autonomous monitors
    logger.info('Starting autonomous monitors...');
    autoAdvertiser.start(client);
    payoutMonitor.start(client);
    staleTicketMonitor.start();
});

client.on('messageCreate', handleMessageCreate);
client.on('channelCreate', handleChannelCreate);

// Error handling
client.on('error', (error) => {
    logger.error('Discord client error', { error: error.message });
});

client.on('warn', (warning) => {
    logger.warn('Discord client warning', { warning });
});

// Reconnection handling
client.on('disconnect', () => {
    logger.warn('Disconnected from Discord, attempting reconnect...');
});

client.on('reconnecting', () => {
    logger.info('Reconnecting to Discord...');
});

// Graceful shutdown
async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop monitors
    autoAdvertiser.stop();
    payoutMonitor.stop();
    staleTicketMonitor.stop();

    // Save state
    shutdown();

    // Destroy client
    client.destroy();

    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown(); // Try to save state
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
});

// Start the bot
logger.info('Starting Discord Wagering Bot...');
client.login(process.env.DISCORD_TOKEN)
    .catch((error) => {
        logger.error('Failed to login', { error: error.message });
        process.exit(1);
    });
