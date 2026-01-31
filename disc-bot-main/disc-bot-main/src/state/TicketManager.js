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
        this.pendingWagerExpiryMs = 24 * 60 * 60 * 1000; // 24 Hours (Requirement: Link older wagers)

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
        if (!this.pendingWagers.has(userId)) {
            this.pendingWagers.set(userId, []);
        }

        const wager = {
            id: `wager-${userId}-${Date.now()}`,
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
        };

        this.pendingWagers.get(userId).push(wager);
        logger.info('Stored pending wager', { userId, username, opponentBet, ourBet, messageId: snipeContext.messageId });

        // Limit wagers per user to 5 to prevent memory leak
        const wagers = this.pendingWagers.get(userId);
        if (wagers.length > 5) {
            wagers.shift();
        }

        this.triggerSave();
    }

    getPendingWager(userId) {
        const wagers = this.pendingWagers.get(userId);
        if (!wagers || wagers.length === 0) return null;

        // Clean up expired wagers for this user
        const validWagers = wagers.filter(w => Date.now() - w.timestamp <= this.pendingWagerExpiryMs);
        this.pendingWagers.set(userId, validWagers);

        if (validWagers.length === 0) return null;

        // If there's only one, return it (backwards compat)
        if (validWagers.length === 1) return validWagers[0];

        // If multiple, return the most recent one by default but flag as ambiguous
        return { ...validWagers[validWagers.length - 1], isAmbiguous: true, candidates: validWagers };
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

        let candidates = [];

        // Flatten all current wagers into a single list with scores
        for (const [userId, userWagers] of this.pendingWagers.entries()) {
            const wagers = Array.isArray(userWagers) ? userWagers : [userWagers];
            for (const wager of wagers) {
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

                if (score >= 30) {
                    candidates.push({ wager, score, matchReasons });
                }
            }
        }

        // Sort candidates by score descending
        candidates.sort((a, b) => b.score - a.score);

        // 1. CLEAR HIGH CONFIDENCE MATCH (Score difference > 30)
        if (candidates.length > 0 && (candidates.length === 1 || (candidates[0].score - candidates[1].score > 30))) {
            const best = candidates[0];
            if (best.score >= 50) {
                this.removePendingWager(best.wager.id);
                logger.info('🎯 CORRELATION SUCCESS', {
                    userId: best.wager.userId,
                    channelName,
                    score: best.score,
                    reasons: best.matchReasons
                });
                return best.wager;
            }
        }

        // 2. AMBIGUOUS CASE: Multiple similar matches
        if (candidates.length > 1 && (candidates[0].score - candidates[1].score <= 30)) {
            logger.warn('⚠️ AMBIGUOUS MATCH FOUND', {
                channelName,
                candidateCount: candidates.length,
                topScores: candidates.slice(0, 3).map(c => c.score)
            });
            return {
                isAmbiguous: true,
                candidates: candidates.slice(0, 5).map(c => c.wager)
            };
        }

        // 3. FALLBACK: Return best match if score is reasonable, but mark as low confidence
        if (candidates.length > 0 && candidates[0].score >= 30) {
            return {
                ...candidates[0].wager,
                isLowConfidence: true,
                score: candidates[0].score
            };
        }

        logger.warn('⚠️ No confident wager match found', {
            channelName,
            pendingCount: Array.from(this.pendingWagers.values()).flat().length
        });
        return null;
    }

    removePendingWager(wagerId) {
        for (const [userId, wagers] of this.pendingWagers.entries()) {
            const index = wagers.findIndex(w => w.id === wagerId);
            if (index !== -1) {
                wagers.splice(index, 1);
                if (wagers.length === 0) this.pendingWagers.delete(userId);
                this.triggerSave();
                return true;
            }
        }
        return false;
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
        for (const [userId, wagers] of this.pendingWagers.entries()) {
            const validWagers = wagers.filter(w => now - w.timestamp <= this.pendingWagerExpiryMs);
            if (validWagers.length === 0) {
                this.pendingWagers.delete(userId);
            } else if (validWagers.length !== wagers.length) {
                this.pendingWagers.set(userId, validWagers);
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
            // Legacy support: convert single wagers to arrays
            this.pendingWagers.set(userId, Array.isArray(wager) ? wager : [wager]);
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
