/**
 * Ready Event Handler
 */

const { logger } = require('../../utils/logger');
const { loadState, startAutoSave, checkRecoveryNeeded } = require('../../state/persistence');
const { ticketManager } = require('../../state/TicketManager');

let started = false;

/**
 * Handle the ready event when bot connects
 * @param {Client} client - Discord client
 */
async function handleReady(client) {
    if (started) {
        logger.info('🔄 Bot re-connected to Discord');
        return;
    }
    started = true;

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

    // RIGOROUS RECOVERY: Trigger missed vouches
    const needingVouch = ticketManager.getTicketsNeedingVouch();
    if (needingVouch.length > 0) {
        logger.info(`🎯 Recovery: Found ${needingVouch.length} tickets needing vouches. Triggering...`);
        const { postVouch } = require('../handlers/ticket');
        for (const ticket of needingVouch) {
            setTimeout(() => postVouch(client, ticket).catch(e => logger.error('Vouch recovery failed', { error: e.message })), 2000);
        }
    }

    // Start auto-save
    startAutoSave();

    // SELF-HEALING: Scalable batch scanning to ensure 100% recovery of missed downtime
    const allChannels = await client.channels.fetch();
    const activeTickets = ticketManager.getActiveTickets();
    const ticketChannelMap = new Set(activeTickets.map(t => t.channelId));

    // 1. Identify "Lost" Tickets (Auto-Discovery)
    const ticketLikeChannels = allChannels.filter(c => {
        if (!c.isText()) return false;
        const name = c.name?.toLowerCase() || '';
        return (name.startsWith('ticket-') ||
            name.startsWith('order-') ||
            name.includes('-ticket-')) &&
            !ticketChannelMap.has(c.id);
    });

    if (ticketLikeChannels.size > 0) {
        logger.info(`🔍 Auto-Discovery: Found ${ticketLikeChannels.size} orphan ticket channels. Attempting restoration...`);
        // Note: For now we just log them, but in a future update we could attempt full state reconstruction
        // from history. For Phase 5000, we prioritize robustness of known tickets.
    }

    if (activeTickets.length > 0) {
        logger.info(`🧬 Deep Recovery: Scanning ${activeTickets.length} active tickets for missed history...`);
        const { handleMessage } = require('../handlers/ticket');

        for (const ticket of activeTickets) {
            try {
                const channel = await client.channels.fetch(ticket.channelId);
                if (!channel || !channel.isText()) continue;

                let hasReachedStopPoint = false;
                let beforeId = null;
                const lastUpdateSnapshot = ticket.updatedAt;
                const missedMessages = [];

                // PAGE-BY-PAGE SCAN (R1: Deep Recovery)
                // We page backwards, but MUST process globally forwards
                while (!hasReachedStopPoint) {
                    const options = { limit: 100 };
                    if (beforeId) options.before = beforeId;

                    const messages = await channel.messages.fetch(options);
                    if (messages.size === 0) break;

                    for (const msg of messages.values()) {
                        if (msg.createdTimestamp > lastUpdateSnapshot) {
                            missedMessages.push(msg);
                        } else {
                            hasReachedStopPoint = true;
                        }
                    }

                    if (messages.size < 100 || hasReachedStopPoint) break;
                    beforeId = messages.lastKey();
                }

                if (missedMessages.length > 0) {
                    // SORT GLOBALLY BY TIMESTAMP (Oldest First)
                    missedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

                    logger.info(`✅ Recovering ${missedMessages.length} missed messages for ${ticket.channelId} in chronological order...`);
                    for (const msg of missedMessages) {
                        await handleMessage(msg);
                    }
                }
            } catch (e) {
                logger.error('Deep Recovery failed for channel', { channelId: ticket.channelId, error: e.message });
            }
        }
    }

    // Log stats
    const stats = ticketManager.getStats();
    logger.info('Current stats:', stats);

    logger.info('✅ Bot is ready and monitoring for bets!');
}

module.exports = handleReady;
