/**
 * Ready Event Handler
 */

const { logger } = require('../../utils/logger');
const { loadState, startAutoSave, checkRecoveryNeeded } = require('../../state/persistence');
const { ticketManager } = require('../../state/TicketManager');
const { autoAdvertiser } = require('../AutoAdvertiser');
const { staleTicketMonitor } = require('../monitors/StaleTicketMonitor');

/**
 * Handle the ready event when bot connects
 * @param {Client} client - Discord client
 */
async function handleReady(client) {
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

    logger.info('✅ Bot is ready and monitoring for bets!');
}

module.exports = handleReady;
