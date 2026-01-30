/**
 * Ticket Manager - Tracks all active tickets and user cooldowns
 */

const { TicketStateMachine, STATES } = require('./StateMachine');
const { logger } = require('../utils/logger');
const config = require('../../config.json');

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.cooldowns = new Map();
        // Pending wagers: store bet info when user is sniped, to be linked when ticket is created
        // Key: userId, Value: { opponentBet, ourBet, channelId, timestamp }
        this.pendingWagers = new Map();
        // Cooldown duration: Use config or default to 2.5 seconds (anti-spam)
        this.cooldownDuration = config.bet_cooldown_ms || 2500;
        // Pending wager expiry: 5 minutes (should be enough time to create ticket)
        this.pendingWagerExpiryMs = 5 * 60 * 1000;
    }

    createTicket(channelId, data) {
        if (this.tickets.has(channelId)) {
            logger.warn('Ticket exists', { channelId });
            return this.tickets.get(channelId);
        }
        const ticket = new TicketStateMachine(channelId, data);
        this.tickets.set(channelId, ticket);
        if (data.opponentId) this.setCooldown(data.opponentId);
        logger.info('Created ticket', { channelId, data });
        return ticket;
    }

    getTicket(channelId) { return this.tickets.get(channelId); }

    getTicketByUser(userId) {
        for (const t of this.tickets.values()) {
            if (t.data.opponentId === userId && !t.isComplete()) return t;
        }
        return undefined;
    }

    isUserInActiveTicket(userId) { return !!this.getTicketByUser(userId); }

    removeTicket(channelId) {
        const t = this.tickets.get(channelId);
        if (t) {
            if (t.data.opponentId) this.clearCooldown(t.data.opponentId);
            this.tickets.delete(channelId);
            logger.info('Removed ticket', { channelId });
        }
    }

    setCooldown(userId) { this.cooldowns.set(userId, Date.now()); }
    clearCooldown(userId) { this.cooldowns.delete(userId); }

    isOnCooldown(userId) {
        const last = this.cooldowns.get(userId);
        if (!last) return false;
        if (Date.now() - last >= this.cooldownDuration) {
            this.cooldowns.delete(userId);
            return false;
        }
        return true;
    }

    getActiveTickets() { return [...this.tickets.values()].filter(t => !t.isComplete()); }

    getTicketsWithPendingPayments() {
        return [...this.tickets.values()].filter(t => t.hasPaymentBeenSent() && !t.isComplete());
    }

    cleanupOldTickets(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [id, t] of this.tickets.entries()) {
            if (t.isComplete() && (now - t.updatedAt) > maxAgeMs) this.tickets.delete(id);
        }
    }

    toJSON() { return [...this.tickets.values()].map(t => t.toJSON()); }

    fromJSON(data) {
        this.tickets.clear();
        for (const d of data) {
            const t = TicketStateMachine.fromJSON(d);
            this.tickets.set(t.channelId, t);
            if (t.data.opponentId && !t.isComplete()) this.setCooldown(t.data.opponentId);
        }
        logger.info(`Restored ${this.tickets.size} tickets`);
    }

    getStats() {
        const all = [...this.tickets.values()];
        const byState = {};
        Object.values(STATES).forEach(s => byState[s] = all.filter(t => t.state === s).length);
        return { total: all.length, active: all.filter(t => !t.isComplete()).length, byState, cooldowns: this.cooldowns.size, pendingWagers: this.pendingWagers.size };
    }

    // Store a pending wager when user is sniped in public channel
    // This will be retrieved when their ticket channel is created
    storePendingWager(userId, opponentBet, ourBet, sourceChannelId) {
        this.pendingWagers.set(userId, {
            opponentBet,
            ourBet,
            sourceChannelId,
            timestamp: Date.now()
        });
        logger.info('Stored pending wager', { userId, opponentBet, ourBet });
    }

    // Retrieve pending wager for a user (called when ticket is created)
    // Returns the wager data and removes it from pending
    getPendingWager(userId) {
        const wager = this.pendingWagers.get(userId);
        if (!wager) return null;

        // Check if expired
        if (Date.now() - wager.timestamp > this.pendingWagerExpiryMs) {
            this.pendingWagers.delete(userId);
            logger.debug('Pending wager expired', { userId });
            return null;
        }

        // Remove from pending (it's being consumed)
        this.pendingWagers.delete(userId);
        logger.info('Retrieved pending wager', { userId, ...wager });
        return wager;
    }

    // Get any pending wager (for when we don't know user ID from ticket channel name)
    // Returns the most recent unexpired wager
    getAnyPendingWager() {
        const now = Date.now();
        let latestWager = null;
        let latestUserId = null;

        for (const [userId, wager] of this.pendingWagers.entries()) {
            if (now - wager.timestamp > this.pendingWagerExpiryMs) {
                this.pendingWagers.delete(userId);
                continue;
            }
            if (!latestWager || wager.timestamp > latestWager.timestamp) {
                latestWager = wager;
                latestUserId = userId;
            }
        }

        if (latestWager && latestUserId) {
            this.pendingWagers.delete(latestUserId);
            logger.info('Retrieved latest pending wager', { userId: latestUserId, ...latestWager });
            return { userId: latestUserId, ...latestWager };
        }
        return null;
    }

    // Clean up expired pending wagers
    cleanupPendingWagers() {
        const now = Date.now();
        for (const [userId, wager] of this.pendingWagers.entries()) {
            if (now - wager.timestamp > this.pendingWagerExpiryMs) {
                this.pendingWagers.delete(userId);
            }
        }
    }
}

const ticketManager = new TicketManager();
module.exports = { TicketManager, ticketManager };
