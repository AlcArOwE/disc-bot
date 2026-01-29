/**
 * Ticket Manager - Tracks all active tickets and user cooldowns
 */

const { TicketStateMachine, STATES } = require('./StateMachine');
const { logger } = require('../utils/logger');
const config = require('../../config.json');

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.userIndex = new Map(); // O(1) lookup for user -> active ticket
        this.cooldowns = new Map();
        // Cooldown duration: Use config or default to 1 second
        this.cooldownDuration = config.bet_cooldown_ms || 1000;
    }

    createTicket(channelId, data) {
        if (this.tickets.has(channelId)) {
            logger.warn('Ticket exists', { channelId });
            return this.tickets.get(channelId);
        }
        const ticket = new TicketStateMachine(channelId, data);
        this.tickets.set(channelId, ticket);

        if (data.opponentId) {
            this.setCooldown(data.opponentId);
            this.userIndex.set(data.opponentId, ticket);
        }

        logger.info('Created ticket', { channelId, data });
        return ticket;
    }

    /**
     * Register an opponent to an existing ticket (late binding)
     */
    registerOpponent(channelId, userId) {
        const ticket = this.getTicket(channelId);
        if (!ticket) return false;

        // If user already in another active ticket, fail
        if (this.isUserInActiveTicket(userId)) {
            return false;
        }

        ticket.updateData({ opponentId: userId });
        this.userIndex.set(userId, ticket);
        this.setCooldown(userId);
        return true;
    }

    getTicket(channelId) { return this.tickets.get(channelId); }

    getTicketByUser(userId) {
        // O(1) lookup
        const ticket = this.userIndex.get(userId);
        // Verify ticket is still active, if not remove from index
        if (ticket && ticket.isComplete()) {
            this.userIndex.delete(userId);
            return undefined;
        }
        return ticket;
    }

    isUserInActiveTicket(userId) { return !!this.getTicketByUser(userId); }

    removeTicket(channelId) {
        const t = this.tickets.get(channelId);
        if (t) {
            if (t.data.opponentId) {
                this.clearCooldown(t.data.opponentId);
                this.userIndex.delete(t.data.opponentId);
            }
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
        // Use Array.from to safely iterate while deleting
        for (const [id, t] of Array.from(this.tickets.entries())) {
            if (t.isComplete() && (now - t.updatedAt) > maxAgeMs) {
                this.removeTicket(id); // Use removeTicket to clean up indices
            }
        }
    }

    toJSON() { return [...this.tickets.values()].map(t => t.toJSON()); }

    fromJSON(data) {
        this.tickets.clear();
        this.userIndex.clear();
        for (const d of data) {
            const t = TicketStateMachine.fromJSON(d);
            this.tickets.set(t.channelId, t);
            if (t.data.opponentId && !t.isComplete()) {
                this.setCooldown(t.data.opponentId);
                this.userIndex.set(t.data.opponentId, t);
            }
        }
        logger.info(`Restored ${this.tickets.size} tickets`);
    }

    getStats() {
        const all = [...this.tickets.values()];
        const byState = {};
        Object.values(STATES).forEach(s => byState[s] = all.filter(t => t.state === s).length);
        return {
            total: all.length,
            active: all.filter(t => !t.isComplete()).length,
            byState,
            cooldowns: this.cooldowns.size,
            indexedUsers: this.userIndex.size
        };
    }
}

const ticketManager = new TicketManager();
module.exports = { TicketManager, ticketManager };
