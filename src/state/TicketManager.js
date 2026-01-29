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
        // Cooldown duration: Use config or default to 3.5 seconds
        this.cooldownDuration = config.bet_cooldown_ms || 3500;
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
        return { total: all.length, active: all.filter(t => !t.isComplete()).length, byState, cooldowns: this.cooldowns.size };
    }
}

const ticketManager = new TicketManager();
module.exports = { TicketManager, ticketManager };
