/**
 * TicketManager - Manages active bet tickets and state machine
 */

const { TicketStateMachine } = require('./StateMachine');
const { logger } = require('../utils/logger');
const config = require('../../config.json');

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.cooldowns = new Map();
        this.pendingWagers = new Map();

        // Rigorous Idempotency Registries (Requirement 3 & 10)
        this.processedTransactions = new Map(); // msgId -> txId/dryRunId
        this.vouchedChannels = new Set();      // Set of channelIds

        this.cooldownDuration = (config.limit_settings?.user_cooldown_minutes || 5) * 60 * 1000;
        this.pendingWagerExpiryMs = 2 * 60 * 1000;

        this.cleanupInterval = setInterval(() => {
            this.cleanupOldTickets();
            this.cleanupPendingWagers();
        }, 5 * 60 * 1000);
    }

    createTicket(channelId, data = {}) {
        const ticket = new TicketStateMachine(channelId, data);
        this.tickets.set(channelId, ticket);
        this.triggerSave();
        return ticket;
    }

    getTicket(channelId) {
        return this.tickets.get(channelId);
    }

    removeTicket(channelId) {
        if (this.tickets.has(channelId)) {
            this.tickets.delete(channelId);
            this.triggerSave();
            return true;
        }
        return false;
    }

    getActiveTickets() {
        return [...this.tickets.values()].filter(t => !t.isComplete());
    }

    isOnCooldown(userId) {
        const expiresAt = this.cooldowns.get(userId);
        if (!expiresAt) return false;
        if (Date.now() >= expiresAt) {
            this.cooldowns.delete(userId);
            return false;
        }
        return true;
    }

    setCooldown(userId, durationMs = null) {
        // Use provided duration or fall back to configured cooldown
        const duration = durationMs || this.cooldownDuration;
        // Store expiry time instead of start time for clearer logic
        this.cooldowns.set(userId, Date.now() + duration);
        this.triggerSave();
    }

    clearCooldown(userId) {
        this.cooldowns.delete(userId);
        this.triggerSave();
    }

    // Idempotency methods
    isTransactionProcessed(messageId) {
        return this.processedTransactions.has(messageId);
    }

    recordTransaction(messageId, txId) {
        this.processedTransactions.set(messageId, txId);
        this.triggerSave();
    }

    isVouchPosted(channelId) {
        return this.vouchedChannels.has(channelId);
    }

    recordVouch(channelId) {
        this.vouchedChannels.add(channelId);
        this.triggerSave();
    }

    // Trigger save (debounced slightly to prevent IO thrashing if many changes happen at once)
    triggerSave() {
        const { saveState } = require('./persistence');
        saveState();
    }

    /**
     * Store pending wager with enhanced correlation data
     * @param {object} snipeContext - Full snipe context for correlation
     */
    storePendingWager(userId, opponentBet, ourBet, sourceChannelId, username, snipeContext = {}) {
        this.pendingWagers.set(userId, {
            userId,
            opponentBet,
            ourBet,
            sourceChannelId,
            username,
            timestamp: Date.now(),
            // Enhanced correlation data
            snipeId: snipeContext.snipeId || `legacy-${Date.now()}`,
            messageId: snipeContext.messageId || null,
            guildId: snipeContext.guildId || null,
            betTermsRaw: snipeContext.betTermsRaw || `${opponentBet}v${opponentBet}`,
        });
        logger.info('Stored pending wager', { userId, username, opponentBet, ourBet, messageId: snipeContext.messageId });
        this.triggerSave();
    }

    getPendingWager(userId) {
        const wager = this.pendingWagers.get(userId);
        if (!wager) return null;
        if (Date.now() - wager.timestamp > this.pendingWagerExpiryMs) {
            this.pendingWagers.delete(userId);
            return null;
        }
        // DO NOT delete here, let the ticket handler delete after link
        return wager;
    }

    /**
     * Find best matching pending wager using multi-factor correlation
     * @param {string} channelName - Ticket channel name
     * @param {object} context - Additional context for matching
     * @returns {object|null} - Matched wager or null
     */
    getAnyPendingWager(channelName = '', context = {}) {
        const now = Date.now();
        const lowerName = (channelName || '').toLowerCase();
        const { mentions = [], messageContent = '', betAmount = 0 } = context;

        let bestMatch = null;
        let bestScore = 0;

        for (const [userId, wager] of this.pendingWagers.entries()) {
            // Skip expired wagers
            if (now - wager.timestamp > this.pendingWagerExpiryMs) {
                continue;
            }

            let score = 0;
            let matchReasons = [];

            // Priority 1: User ID in channel name (strongest signal)
            if (lowerName.includes(userId.toLowerCase())) {
                score += 100;
                matchReasons.push('userId_in_channel');
            }

            // Priority 2: Username in channel name
            const username = (wager.username || '').toLowerCase();
            if (username && lowerName.includes(username)) {
                score += 80;
                matchReasons.push('username_in_channel');
            }

            // Priority 3: User mentioned in ticket messages
            if (mentions.includes(userId)) {
                score += 90;
                matchReasons.push('user_mentioned');
            }

            // Priority 4: Bet amount matches
            if (betAmount > 0 && Math.abs(betAmount - wager.opponentBet) < 0.01) {
                score += 70;
                matchReasons.push('bet_amount_match');
            }

            // Priority 5: Time proximity (more recent = higher score)
            const ageMs = now - wager.timestamp;
            const timeScore = Math.max(0, 30 - Math.floor(ageMs / 10000)); // Decay over 5 mins
            score += timeScore;
            if (timeScore > 0) matchReasons.push(`time_proximity(${Math.floor(ageMs / 1000)}s)`);

            if (score > bestScore) {
                bestScore = score;
                bestMatch = { userId, wager, score, matchReasons };
            }
        }

        // Require minimum score for confident match
        if (bestMatch && bestScore >= 50) {
            this.pendingWagers.delete(bestMatch.userId);
            this.triggerSave();
            logger.info('🎯 CORRELATION SUCCESS', {
                userId: bestMatch.userId,
                channelName,
                score: bestScore,
                reasons: bestMatch.matchReasons
            });
            return bestMatch.wager;
        }

        // Fallback: Single wager within time window (low confidence)
        if (this.pendingWagers.size === 1) {
            const [userId, wager] = this.pendingWagers.entries().next().value;
            if (now - wager.timestamp <= this.pendingWagerExpiryMs) {
                this.pendingWagers.delete(userId);
                this.triggerSave();
                logger.info('🎯 FALLBACK LINK (Single pending wager)', { userId });
                return wager;
            }
        }

        logger.warn('⚠️ No confident wager match found', {
            channelName,
            pendingCount: this.pendingWagers.size,
            bestScore
        });
        return null;
    }

    cleanupOldTickets() {
        const now = Date.now();
        for (const [channelId, ticket] of this.tickets.entries()) {
            if (ticket.isComplete() && now - ticket.lastUpdate > 24 * 60 * 60 * 1000) {
                this.tickets.delete(channelId);
            }
        }
    }

    cleanupPendingWagers() {
        const now = Date.now();
        for (const [userId, wager] of this.pendingWagers.entries()) {
            if (now - wager.timestamp > this.pendingWagerExpiryMs) {
                this.pendingWagers.delete(userId);
            }
        }
    }

    toJSON() {
        return {
            tickets: [...this.tickets.values()].map(t => t.toJSON()),
            pendingWagers: [...this.pendingWagers.entries()],
            cooldowns: [...this.cooldowns.entries()],
            processedTransactions: [...this.processedTransactions.entries()],
            vouchedChannels: [...this.vouchedChannels]
        };
    }

    fromJSON(data) {
        this.tickets.clear();
        this.pendingWagers.clear();
        this.cooldowns.clear();
        this.processedTransactions.clear();
        this.vouchedChannels.clear();

        const ticketsData = data.tickets || [];
        const wagersData = data.pendingWagers || [];
        const cooldownsData = data.cooldowns || [];
        const txData = data.processedTransactions || [];
        const vouchData = data.vouchedChannels || [];

        for (const d of ticketsData) {
            const t = TicketStateMachine.fromJSON(d);
            this.tickets.set(t.channelId, t);
        }
        for (const [userId, wager] of wagersData) {
            this.pendingWagers.set(userId, wager);
        }
        for (const [userId, timestamp] of cooldownsData) {
            this.cooldowns.set(userId, timestamp);
        }
        for (const [msgId, txId] of txData) {
            this.processedTransactions.set(msgId, txId);
        }
        for (const channelId of vouchData) {
            this.vouchedChannels.add(channelId);
        }
    }

    /**
     * Clear ephemeral locks after process restart
     */
    clearStaleLocks() {
        for (const ticket of this.tickets.values()) {
            if (ticket.data.paymentLocked) {
                logger.warn('🔓 Unlocking stale payment lock after restart', { channelId: ticket.channelId });
                ticket.updateData({ paymentLocked: false });
            }
        }
    }

    /**
     * Identify tickets that were in middle of payment
     */
    getTicketsWithPendingPayments() {
        const { STATES } = require('./StateMachine');
        return [...this.tickets.values()].filter(t =>
            t.state === STATES.AWAITING_PAYMENT_ADDRESS ||
            t.state === STATES.PAYMENT_SENT
        );
    }

    /**
     * Identify completed bot wins that haven't been vouched
     */
    getTicketsNeedingVouch() {
        const { STATES } = require('./StateMachine');
        return [...this.tickets.values()].filter(t =>
            t.state === STATES.GAME_COMPLETE &&
            t.data.winner === 'bot' &&
            !this.isVouchPosted(t.channelId)
        );
    }

    getStats() {
        const active = this.getActiveTickets();
        const complete = [...this.tickets.values()].filter(t => t.isComplete());
        return {
            activeCount: active.length,
            completeCount: complete.length,
            pendingWagers: this.pendingWagers.size,
            vouchedCount: this.vouchedChannels.size,
            txCount: this.processedTransactions.size
        };
    }
}

const ticketManager = new TicketManager();

module.exports = {
    TicketManager,
    ticketManager
};
