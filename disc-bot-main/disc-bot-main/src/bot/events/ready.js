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
 * @param {TicketDiscovery} ticketDiscovery - Ticket discovery service
 */
async function handleReady(client, ticketDiscovery) {
    if (started) {
        logger.info('🔄 Bot re-connected to Discord');
        return;
    }
    started = true;

    // Start ticket discovery
    if (ticketDiscovery) {
        await ticketDiscovery.start();
    }

    logger.info('═══════════════════════════════════════════');
    logger.info(`🎲 Logged in as ${client.user.tag}`);
    logger.info(`📍 User ID: ${client.user.id}`);
    logger.info('═══════════════════════════════════════════');

    // START ADVERTISING SERVICE IMMEDIATELY
    try {
        const adService = require('../../services/AdService');
        adService.start(client);
        logger.info('🚀 ADVERTISING_SERVICE_STARTED');
    } catch (e) {
        logger.error('Failed to start AdService', { error: e.message });
    }

    // Load saved state (crash recovery)
    loadState();
    startAutoSave();

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY LOGIC (Wrapped in try-catch to prevent blocking)
    // ═══════════════════════════════════════════════════════════════════════
    let activeTickets = []; // Define activeTickets here to ensure scope for later use
    try {
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
                setTimeout(() => postVouch(client, ticket).catch(e => logger.error('Vouch recovery failed', { error: e.message })), 10);
            }
        }

        // SELF-HEALING: Batch scanning
        const allChannels = await client.channels.fetch().catch(e => {
            logger.warn('Discovery: Failed to fetch channels (404/Permissions)', { error: e.message });
            return null;
        });

        if (allChannels) {
            activeTickets = ticketManager.getActiveTickets(); // Assign to the outer-scoped variable
            const ticketChannelMap = new Set(activeTickets.map(t => t.channelId));

            const ticketLikeChannels = allChannels.filter(c => {
                if (!c.isText()) return false;
                const name = c.name?.toLowerCase() || '';
                return (name.startsWith('ticket-') || name.startsWith('order-') || name.includes('-ticket-')) && !ticketChannelMap.has(c.id);
            });

            if (ticketLikeChannels.size > 0) {
                logger.info(`🔍 Auto-Discovery: Found ${ticketLikeChannels.size} orphan ticket channels. Attempting restoration...`);
                // Note: For now we just log them, but in a future update we could attempt full state reconstruction
            }
        }
    } catch (recoveryError) {
        logger.error('Non-critical recovery error during channel discovery or initial ticket checks', { error: recoveryError.message });
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
