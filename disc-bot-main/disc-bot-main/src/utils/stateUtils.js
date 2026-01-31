/**
 * State Machine Utilities
 * Phase 5: Enhanced state management tools
 */

const { STATES } = require('../state/StateMachine');
const { logger } = require('./logger');
const fs = require('fs');
const path = require('path');

// Valid state transitions (mirrored from StateMachine.js for validation)
const VALID_TRANSITIONS = {
    [STATES.AWAITING_TICKET]: [STATES.AWAITING_MIDDLEMAN, STATES.CANCELLED],
    [STATES.AWAITING_MIDDLEMAN]: [STATES.AWAITING_PAYMENT_ADDRESS, STATES.CANCELLED],
    [STATES.AWAITING_PAYMENT_ADDRESS]: [STATES.PAYMENT_SENT, STATES.CANCELLED],
    [STATES.PAYMENT_SENT]: [STATES.AWAITING_GAME_START, STATES.CANCELLED],
    [STATES.AWAITING_GAME_START]: [STATES.GAME_IN_PROGRESS, STATES.CANCELLED],
    [STATES.GAME_IN_PROGRESS]: [STATES.GAME_COMPLETE, STATES.CANCELLED],
    [STATES.GAME_COMPLETE]: [],
    [STATES.CANCELLED]: []
};

// State invariants - conditions that must be true for each state
const STATE_INVARIANTS = {
    [STATES.AWAITING_TICKET]: (ticket) => true, // Initial state, no requirements
    [STATES.AWAITING_MIDDLEMAN]: (ticket) => ticket.channelId != null,
    [STATES.AWAITING_PAYMENT_ADDRESS]: (ticket) => ticket.data?.middlemanId != null,
    [STATES.PAYMENT_SENT]: (ticket) => ticket.data?.paymentTxId != null || ticket.data?.paymentAddress != null,
    [STATES.AWAITING_GAME_START]: (ticket) => ticket.data?.paymentTxId != null,
    [STATES.GAME_IN_PROGRESS]: (ticket) => ticket.data?.paymentTxId != null,
    [STATES.GAME_COMPLETE]: (ticket) => ticket.data?.winner != null || ticket.isComplete?.(),
    [STATES.CANCELLED]: (ticket) => true
};

// State metrics for monitoring
const stateMetrics = {
    transitions: new Map(), // from-to -> count
    failures: new Map(),    // from-to -> count
    avgDuration: new Map(), // state -> avg ms in state
    stateCounts: new Map()  // state -> current count
};

/**
 * Validate state invariants for a ticket
 * @param {Object} ticket - Ticket state machine
 * @returns {{valid: boolean, violations: string[]}}
 */
function validateInvariants(ticket) {
    if (!ticket || !ticket.state) {
        return { valid: false, violations: ['Invalid ticket object'] };
    }

    const violations = [];
    const invariant = STATE_INVARIANTS[ticket.state];

    if (!invariant) {
        violations.push(`Unknown state: ${ticket.state}`);
    } else if (!invariant(ticket)) {
        violations.push(`Invariant violation for state ${ticket.state}`);
    }

    // Additional checks
    if (ticket.data?.paymentTxId && ticket.state === STATES.AWAITING_TICKET) {
        violations.push('Payment exists but state is AWAITING_TICKET');
    }

    if (ticket.data?.winner && ticket.state !== STATES.GAME_COMPLETE && ticket.state !== STATES.CANCELLED) {
        violations.push('Winner set but game not complete');
    }

    return {
        valid: violations.length === 0,
        violations
    };
}

/**
 * Detect corruption in ticket state
 * @param {Object} ticket - Ticket state machine
 * @returns {{corrupted: boolean, issues: string[]}}
 */
function detectCorruption(ticket) {
    const issues = [];

    if (!ticket) {
        return { corrupted: true, issues: ['Ticket is null'] };
    }

    // Check for missing required fields
    if (!ticket.channelId) issues.push('Missing channelId');
    if (!ticket.state) issues.push('Missing state');
    if (!ticket.createdAt) issues.push('Missing createdAt');
    if (!ticket.data) issues.push('Missing data object');

    // Check for invalid state
    if (ticket.state && !Object.values(STATES).includes(ticket.state)) {
        issues.push(`Invalid state: ${ticket.state}`);
    }

    // Check for inconsistent timestamps
    if (ticket.createdAt > ticket.updatedAt) {
        issues.push('createdAt is after updatedAt');
    }

    // Check for negative values
    if (ticket.data?.opponentBet < 0) issues.push('Negative opponent bet');
    if (ticket.data?.ourBet < 0) issues.push('Negative our bet');

    // Check for NaN values
    if (isNaN(ticket.data?.opponentBet)) issues.push('NaN opponent bet');
    if (isNaN(ticket.data?.ourBet)) issues.push('NaN our bet');

    return {
        corrupted: issues.length > 0,
        issues
    };
}

/**
 * Create a rollback point for a ticket
 * @param {Object} ticket - Ticket state machine
 * @returns {Object} Rollback point
 */
function createRollbackPoint(ticket) {
    return {
        timestamp: Date.now(),
        snapshot: JSON.parse(JSON.stringify(ticket.toJSON ? ticket.toJSON() : ticket))
    };
}

/**
 * Apply a rollback to restore ticket state
 * @param {Object} ticket - Ticket state machine
 * @param {Object} rollbackPoint - Previously created rollback point
 * @returns {boolean} Success
 */
function applyRollback(ticket, rollbackPoint) {
    if (!rollbackPoint || !rollbackPoint.snapshot) {
        logger.error('Invalid rollback point');
        return false;
    }

    try {
        const snapshot = rollbackPoint.snapshot;
        ticket.state = snapshot.state;
        ticket.data = { ...snapshot.data };
        ticket.updatedAt = Date.now();

        logger.warn('🔄 State rollback applied', {
            channelId: ticket.channelId,
            restoredState: snapshot.state,
            rollbackTime: rollbackPoint.timestamp
        });

        return true;
    } catch (error) {
        logger.error('Rollback failed', { error: error.message });
        return false;
    }
}

/**
 * Record a state transition for metrics
 * @param {string} fromState - Previous state
 * @param {string} toState - New state
 * @param {boolean} success - Whether transition succeeded
 */
function recordTransition(fromState, toState, success) {
    const key = `${fromState}->${toState}`;

    if (success) {
        const count = stateMetrics.transitions.get(key) || 0;
        stateMetrics.transitions.set(key, count + 1);
    } else {
        const count = stateMetrics.failures.get(key) || 0;
        stateMetrics.failures.set(key, count + 1);
    }
}

/**
 * Get state metrics summary
 * @returns {Object} Metrics summary
 */
function getStateMetrics() {
    return {
        transitions: Object.fromEntries(stateMetrics.transitions),
        failures: Object.fromEntries(stateMetrics.failures),
        totalTransitions: Array.from(stateMetrics.transitions.values()).reduce((a, b) => a + b, 0),
        totalFailures: Array.from(stateMetrics.failures.values()).reduce((a, b) => a + b, 0)
    };
}

/**
 * Debug dump of ticket state
 * @param {Object} ticket - Ticket state machine
 * @returns {string} Debug string
 */
function debugDump(ticket) {
    const corruption = detectCorruption(ticket);
    const invariants = validateInvariants(ticket);

    return JSON.stringify({
        channelId: ticket?.channelId,
        state: ticket?.state,
        age: ticket?.createdAt ? Math.floor((Date.now() - ticket.createdAt) / 1000) + 's' : 'unknown',
        historyLength: ticket?.history?.length || 0,
        data: ticket?.data,
        corruption,
        invariants,
        lastHistory: ticket?.history?.slice(-3) || []
    }, null, 2);
}

/**
 * Find orphaned tickets (no activity for too long)
 * @param {Map} tickets - Map of channel ID to ticket
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {Array} Orphaned ticket IDs
 */
function findOrphanedTickets(tickets, maxAgeMs = 3600000) { // default 1 hour
    const orphaned = [];
    const now = Date.now();

    for (const [channelId, ticket] of tickets) {
        if (!ticket.isComplete || !ticket.isComplete()) {
            const idle = now - (ticket.updatedAt || ticket.createdAt);
            if (idle > maxAgeMs) {
                orphaned.push({
                    channelId,
                    state: ticket.state,
                    idleMinutes: Math.floor(idle / 60000)
                });
            }
        }
    }

    return orphaned;
}

module.exports = {
    validateInvariants,
    detectCorruption,
    createRollbackPoint,
    applyRollback,
    recordTransition,
    getStateMetrics,
    debugDump,
    findOrphanedTickets,
    STATE_INVARIANTS,
    VALID_TRANSITIONS,
    stateMetrics
};
