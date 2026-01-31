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
const { execSync } = require('child_process');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP BANNER - Proves which commit/code is running
// ═══════════════════════════════════════════════════════════════════════════
function printStartupBanner() {
    let gitCommit = 'unknown';
    try {
        gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim().slice(0, 12);
    } catch (e) {
        // Git not available or not a repo
    }

    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('         DISCORD WAGERING BOT - ZENITH-ALPHA EDITION');
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info(`  Git Commit:     ${gitCommit}`);
    logger.info(`  Node Version:   ${process.version}`);
    logger.info(`  Working Dir:    ${process.cwd()}`);
    logger.info(`  Entry Point:    ${__filename}`);
    logger.info(`  Config File:    ${path.resolve(__dirname, '../config.json')}`);
    logger.info('───────────────────────────────────────────────────────────────');
    logger.info(`  Crypto Network: ${config.crypto_network || 'LTC'}`);
    logger.info(`  Simulation:     ${config.simulation_mode ? 'ON' : 'OFF'}`);
    logger.info(`  Live Transfers: ${process.env.ENABLE_LIVE_TRANSFERS === 'true' ? 'ENABLED' : 'DRY-RUN'}`);
    logger.info(`  Cooldown MS:    ${config.bet_cooldown_ms || 2500}`);
    logger.info(`  Max Per TX:     $${config.payment_safety?.max_payment_per_tx || 50}`);
    logger.info(`  Max Daily:      $${config.payment_safety?.max_daily_usd || 500}`);
    logger.info(`  Middlemen:      ${(config.middleman_ids || []).length} configured`);
    logger.info(`  Global Proxy:   ${config.proxy_url ? 'ACTIVE' : 'OFF'}`);
    if (config.proxy_url) logger.info(`  Proxy URL:      ${config.proxy_url.replace(/:[^:@]+@/, ':****@')}`);
    logger.info('═══════════════════════════════════════════════════════════════');
}

printStartupBanner();

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP VALIDATION & CONFIG
// ═══════════════════════════════════════════════════════════════════════════

let discordClientOptions = {};

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

    discordClientOptions = {
        http: {}
    };

    // Add proxy support if configured (R4)
    if (config.proxy_url && config.proxy_url.length > 0) {
        try {
            const HttpsProxyAgent = require('https-proxy-agent');
            discordClientOptions.http.agent = new HttpsProxyAgent(config.proxy_url);
            logger.info('Wired HttpsProxyAgent for global Discord client');
        } catch (e) {
            logger.warn('https-proxy-agent not found, using basic proxy mode', { error: e.message });
            discordClientOptions.proxy = config.proxy_url;
        }
    }

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
        logger.error('═══════════════════════════════════════════════════════════════');
        process.exit(1);
    }

    logger.info('✅ Startup validation passed');
}

validateStartup();

// Create Discord client
const client = createClient(discordClientOptions);

// Register event handlers
client.on('ready', () => handleReady(client));
client.on('messageCreate', (message) => handleMessageCreate(message));
client.on('channelCreate', (channel) => handleChannelCreate(channel));
client.on('channelDelete', (channel) => {
    const { handleChannelDelete } = require('./bot/handlers/ticket');
    handleChannelDelete(channel);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.content === newMessage.content) return;

    // ANTI-FRAUD: Check if the message was already processed in a ticket
    const { ticketManager } = require('./state/TicketManager');
    if (ticketManager.getTicket(oldMessage.channel.id)) {
        const { handleMessageUpdate } = require('./bot/handlers/ticket');
        await handleMessageUpdate(oldMessage, newMessage);
    }
});

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

// Import message queue and ticket manager for event handlers
const { messageQueue } = require('./utils/MessageQueue');
const { ticketManager } = require('./state/TicketManager');

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    if (messageQueue) {
        logger.info('Draining message queue...');
        await messageQueue.drain();
    }
    await shutdown();
    if (client) client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    if (messageQueue) {
        logger.info('Draining message queue...');
        await messageQueue.drain();
    }
    await shutdown();
    if (client) client.destroy();
    process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection - CRASHING FOR RESTART', { reason: String(reason) });
    process.exit(1);
});

// Start the bot
logger.info('Starting Discord Wagering Bot...');
client.login(process.env.DISCORD_TOKEN)
    .catch((error) => {
        logger.error('Failed to login', { error: error.message });
        process.exit(1);
    });
