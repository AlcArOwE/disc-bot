/**
 * Ticket Manager - Tracks all active tickets and user cooldowns
 */

const { TicketStateMachine, STATES } = require('./StateMachine');
const { logger } = require('../utils/logger');
const config = require('../../config.json');

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.userIndex = new Map(); // O(1) lookup for active tickets by user
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

        // Update user index
        if (data.opponentId) {
            this.userIndex.set(data.opponentId, ticket);
            this.setCooldown(data.opponentId);
        }

        logger.info('Created ticket', { channelId, data });
        return ticket;
    }

    getTicket(channelId) { return this.tickets.get(channelId); }

    getTicketByUser(userId) {
        // O(1) lookup using index
        const ticket = this.userIndex.get(userId);
        if (ticket && !ticket.isComplete()) {
            return ticket;
        }
        // Cleanup if ticket is complete/invalid but still in index
        if (ticket && ticket.isComplete()) {
            this.userIndex.delete(userId);
        }
        return undefined;
    }

    isUserInActiveTicket(userId) { return !!this.getTicketByUser(userId); }

    removeTicket(channelId) {
        const t = this.tickets.get(channelId);
        if (t) {
            if (t.data.opponentId) {
                this.clearCooldown(t.data.opponentId);
                // Remove from user index if it matches
                const indexed = this.userIndex.get(t.data.opponentId);
                if (indexed && indexed.channelId === channelId) {
                    this.userIndex.delete(t.data.opponentId);
                }
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
        for (const [id, t] of this.tickets.entries()) {
            if (t.isComplete() && (now - t.updatedAt) > maxAgeMs) {
                // Clean from user index too
                if (t.data.opponentId) {
                    const indexed = this.userIndex.get(t.data.opponentId);
                    if (indexed && indexed.channelId === id) {
                        this.userIndex.delete(t.data.opponentId);
                    }
                }
                this.tickets.delete(id);
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

            // Rebuild user index for active tickets
            if (t.data.opponentId && !t.isComplete()) {
                this.userIndex.set(t.data.opponentId, t);
                this.setCooldown(t.data.opponentId);
            }

            // Explicitly clear paymentLocked flag on restore to prevent stuck payments
            if (t.data.paymentLocked) {
                t.updateData({ paymentLocked: false });
                logger.warn('Unlocked payment for restored ticket', { channelId: t.channelId });
            }
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
