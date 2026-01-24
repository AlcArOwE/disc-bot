/**
 * Discord Wagering Bot - Main Entry Point
 * 
 * A sophisticated automated wagering bot that:
 * - Monitors Discord channels for bet offers (XvX format)
 * - Calculates 15% tax and responds to valid bets
 * - Handles full ticket lifecycle with state machine
 * - Sends cryptocurrency payments automatically
 * - Plays first-to-5 dice games
 * - Posts vouches on wins
 * 
 * WARNING: This is a self-bot which violates Discord TOS.
 * Use at your own risk.
 */

require('dotenv').config();

const { createClient } = require('./bot/client');
const handleReady = require('./bot/events/ready');
const handleMessageCreate = require('./bot/events/messageCreate');
const { shutdown } = require('./state/persistence');
const { logger } = require('./utils/logger');

// Validate environment
if (!process.env.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN not set in .env file!');
    logger.error('Copy .env.example to .env and fill in your token.');
    process.exit(1);
}

// Create Discord client
const client = createClient();

// Register event handlers
client.on('ready', () => handleReady(client));
client.on('messageCreate', handleMessageCreate);

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
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    shutdown();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    shutdown();
    client.destroy();
    process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown();
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
