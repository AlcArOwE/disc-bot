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
        const last = this.cooldowns.get(userId);
        if (!last) return false;
        if (Date.now() - last >= this.cooldownDuration) {
            this.cooldowns.delete(userId);
            return false;
        }
        return true;
    }

    setCooldown(userId) {
        this.cooldowns.set(userId, Date.now());
        this.triggerSave();
    }

    clearCooldown(userId) {
        this.cooldowns.delete(userId);
        this.triggerSave();
    }

    // Trigger save (debounced slightly to prevent IO thrashing if many changes happen at once)
    triggerSave() {
        const { saveState } = require('./persistence');
        saveState();
    }

    storePendingWager(userId, opponentBet, ourBet, sourceChannelId, username) {
        this.pendingWagers.set(userId, {
            userId,
            opponentBet,
            ourBet,
            sourceChannelId,
            username,
            timestamp: Date.now()
        });
        logger.info('Stored pending wager', { userId, username, opponentBet, ourBet });
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

    getAnyPendingWager(channelName = '') {
        const now = Date.now();
        const lowerName = (channelName || '').toLowerCase();

        if (lowerName) {
            for (const [userId, wager] of this.pendingWagers.entries()) {
                const username = (wager.username || '').toLowerCase();
                const cleanUserId = userId.toLowerCase();

                const idMatch = lowerName.includes(cleanUserId);
                const nameMatch = username && (lowerName.includes(username) ||
                    (lowerName.replace('ticket-', '').replace('order-', '') === username));

                if (idMatch || nameMatch) {
                    if (now - wager.timestamp <= this.pendingWagerExpiryMs) {
                        this.pendingWagers.delete(userId);
                        this.triggerSave(); // Ensure linkage is committed
                        logger.info('🎯 ATOMIC LINK SUCCESS', { userId, channelName, matchType: idMatch ? 'ID' : 'NAME' });
                        return wager;
                    }
                }
            }
        }

        if (this.pendingWagers.size === 1) {
            const [userId, wager] = this.pendingWagers.entries().next().value;
            if (now - wager.timestamp <= this.pendingWagerExpiryMs) {
                this.pendingWagers.delete(userId);
                this.triggerSave(); // Ensure linkage is committed
                logger.info('🎯 FALLBACK LINK SUCCESS (Single entry)', { userId });
                return wager;
            }
        }

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
            cooldowns: [...this.cooldowns.entries()]
        };
    }

    fromJSON(data) {
        this.tickets.clear();
        this.pendingWagers.clear();
        this.cooldowns.clear();

        const ticketsData = data.tickets || [];
        const wagersData = data.pendingWagers || [];
        const cooldownsData = data.cooldowns || [];

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
}

const ticketManager = new TicketManager();

module.exports = {
    TicketManager,
    ticketManager
};
