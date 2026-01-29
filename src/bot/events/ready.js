/**
 * Ready Event Handler
 */

const { logger } = require('../../utils/logger');
const { loadState, startAutoSave, checkRecoveryNeeded } = require('../../state/persistence');
const { ticketManager } = require('../../state/TicketManager');
const { autoAdvertiser } = require('../AutoAdvertiser');
const { staleTicketMonitor } = require('../monitors/StaleTicketMonitor');
const { payoutMonitor } = require('../monitors/PayoutMonitor');
const config = require('../../../config.json');

/**
 * Validate configuration and environment
 */
function validateEnvironment() {
    const issues = [];

    // Check .env
    if (!process.env.DISCORD_TOKEN) issues.push('❌ DISCORD_TOKEN is missing');
    if (!process.env.LTC_PRIVATE_KEY && config.crypto_network === 'LTC') issues.push('❌ LTC_PRIVATE_KEY is missing');

    // Check config
    if (!config.middleman_ids || config.middleman_ids.length === 0) issues.push('⚠️ No middleman_ids configured');
    if (!config.payout_addresses[config.crypto_network]) issues.push(`❌ No payout address for ${config.crypto_network}`);

    if (issues.length > 0) {
        logger.error('Environment Validation Issues:', { issues });
        // Fatal errors
        if (issues.some(i => i.includes('❌'))) {
            logger.error('CRITICAL: Fix configuration issues to run the bot.');
            // process.exit(1); // Optional: Crash or just warn heavily
        }
    } else {
        logger.info('✅ Configuration and Environment validated');
    }
}

/**
 * Handle the ready event when bot connects
 * @param {Client} client - Discord client
 */
async function handleReady(client) {
    validateEnvironment();

    logger.info('═══════════════════════════════════════════');
    logger.info(`🎲 Logged in as ${client.user.tag}`);
    logger.info(`📍 User ID: ${client.user.id}`);
    logger.info('═══════════════════════════════════════════');

    // Load saved state (crash recovery)
    loadState();

    // Check for tickets needing attention
    const pendingPayments = checkRecoveryNeeded();
    if (pendingPayments.length > 0) {
        logger.warn('⚠️  ATTENTION: Found pending payment tickets!');
        pendingPayments.forEach(ticket => {
            logger.warn(`   - Channel ${ticket.channelId}: State=${ticket.state}, TxID=${ticket.data.paymentTxId}`);
        });
    }

    // Start auto-save
    startAutoSave();

    // Log stats
    const stats = ticketManager.getStats();
    logger.info('Current stats:', stats);

    // Start auto-advertiser
    autoAdvertiser.start(client);

    // Start stale ticket monitor
    staleTicketMonitor.start(client);

    // Start payout monitor
    payoutMonitor.start(client);

    logger.info('✅ Bot is ready and monitoring for bets!');
}

module.exports = handleReady;
