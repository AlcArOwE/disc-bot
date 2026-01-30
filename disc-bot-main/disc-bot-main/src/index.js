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
const config = require('../config.json');

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP VALIDATION - Fail fast with clear error messages
// ═══════════════════════════════════════════════════════════════════════════

function validateStartup() {
    const errors = [];
    const warnings = [];

    // REQUIRED: Discord token
    if (!process.env.DISCORD_TOKEN) {
        errors.push('❌ DISCORD_TOKEN not set in .env file');
    }

    // REQUIRED: At least one crypto private key
    const hasLTC = !!process.env.LTC_PRIVATE_KEY;
    const hasSOL = !!process.env.SOL_PRIVATE_KEY;
    if (!hasLTC && !hasSOL) {
        errors.push('❌ No crypto private key set. Add LTC_PRIVATE_KEY or SOL_PRIVATE_KEY to .env');
    }

    // REQUIRED: Middleman IDs configured
    if (!config.middleman_ids || config.middleman_ids.length === 0) {
        errors.push('❌ No middleman IDs configured in config.json');
    }

    // REQUIRED: Vouch channel
    const vouchChannel = process.env.VOUCH_CHANNEL_ID || config.channels?.vouch_channel_id;
    if (!vouchChannel || vouchChannel === 'YOUR_VOUCH_CHANNEL_ID') {
        warnings.push('⚠️ Vouch channel not configured - vouches will not be posted');
    }

    // OPTIONAL: Check live transfers status
    if (process.env.ENABLE_LIVE_TRANSFERS !== 'true') {
        warnings.push('⚠️ DRY-RUN MODE ACTIVE: Payments will be simulated. Set ENABLE_LIVE_TRANSFERS=true to send real money.');
    } else {
        logger.warn('🔴 LIVE TRANSFERS ENABLED - Real money will be sent!');
    }

    // OPTIONAL: Check configured network
    const network = config.crypto_network?.toUpperCase();
    if (network === 'LTC' && !hasLTC) {
        errors.push('❌ crypto_network is LTC but LTC_PRIVATE_KEY not set');
    }
    if (network === 'SOL' && !hasSOL) {
        errors.push('❌ crypto_network is SOL but SOL_PRIVATE_KEY not set');
    }

    // Log warnings
    warnings.forEach(w => logger.warn(w));

    // If errors, fail fast
    if (errors.length > 0) {
        logger.error('═══════════════════════════════════════════════════════════════');
        logger.error('STARTUP VALIDATION FAILED');
        logger.error('═══════════════════════════════════════════════════════════════');
        errors.forEach(e => logger.error(e));
        logger.error('');
        logger.error('Copy .env.example to .env and fill in your values.');
        logger.error('═══════════════════════════════════════════════════════════════');
        process.exit(1);
    }

    logger.info('✅ Startup validation passed');
}

validateStartup();

// Create Discord client
const client = createClient();

// Register event handlers
client.on('ready', () => handleReady(client));
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
