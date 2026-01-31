/**
 * Ticket Validator
 * Phase 3: Validation functions for ticket safety
 */

const { STATES } = require('../state/StateMachine');
const { logger } = require('./logger');
const config = require('../../config.json');

// Valid state transitions
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

// Ticket patterns from config
const TICKET_PATTERNS = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-'];

/**
 * Validate a ticket's current state and data
 * @param {Object} ticket - Ticket object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateTicket(ticket) {
    const errors = [];

    if (!ticket) {
        return { valid: false, errors: ['Ticket is null or undefined'] };
    }

    // Check required fields
    if (!ticket.channelId) {
        errors.push('Missing channelId');
    }

    if (!ticket.state) {
        errors.push('Missing state');
    }

    if (!ticket.data) {
        errors.push('Missing data object');
    }

    // Check state is valid
    if (ticket.state && !Object.values(STATES).includes(ticket.state)) {
        errors.push(`Invalid state: ${ticket.state}`);
    }

    // Check data integrity based on state
    if (ticket.state === STATES.PAYMENT_SENT ||
        ticket.state === STATES.GAME_IN_PROGRESS ||
        ticket.state === STATES.GAME_COMPLETE) {
        if (!ticket.data?.paymentTxId && ticket.state !== STATES.GAME_IN_PROGRESS) {
            errors.push('Missing paymentTxId for post-payment state');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate that a state transition is allowed
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {{valid: boolean, reason: string}}
 */
function validateTransition(fromState, toState) {
    const allowedTransitions = VALID_TRANSITIONS[fromState];

    if (!allowedTransitions) {
        return { valid: false, reason: `Unknown current state: ${fromState}` };
    }

    if (!allowedTransitions.includes(toState)) {
        return {
            valid: false,
            reason: `Transition from ${fromState} to ${toState} is not allowed. Valid: ${allowedTransitions.join(', ')}`
        };
    }

    return { valid: true, reason: 'Valid transition' };
}

/**
 * Verify that a user is authorized to perform actions on a ticket
 * @param {Object} ticket - Ticket object
 * @param {string} userId - Discord user ID
 * @param {string} action - Action being attempted
 * @returns {{authorized: boolean, reason: string}}
 */
function verifyTicketOwnership(ticket, userId, action) {
    if (!ticket || !userId) {
        return { authorized: false, reason: 'Missing ticket or userId' };
    }

    const middlemanIds = config.middleman_ids || [];
    const isMiddleman = middlemanIds.includes(userId);

    // Middlemen can always act on tickets
    if (isMiddleman) {
        return { authorized: true, reason: 'User is middleman' };
    }

    // Opponent can perform certain actions
    if (ticket.data?.opponentId === userId) {
        const opponentActions = ['cancel', 'roll', 'confirm', 'chat'];
        if (opponentActions.includes(action)) {
            return { authorized: true, reason: 'User is opponent' };
        }
    }

    // For payment-related actions, only middleman is authorized
    if (action === 'payment' || action === 'send_payment') {
        return { authorized: false, reason: 'Only middleman can handle payments' };
    }

    return { authorized: false, reason: `User ${userId} not authorized for action ${action}` };
}

/**
 * Check if a channel name matches ticket patterns
 * @param {string} channelName - Channel name
 * @returns {boolean}
 */
function isTicketChannelName(channelName) {
    if (!channelName) return false;
    const lower = channelName.toLowerCase();
    return TICKET_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Calculate ticket age in minutes
 * @param {Object} ticket - Ticket object
 * @returns {number} Age in minutes
 */
function getTicketAgeMinutes(ticket) {
    if (!ticket?.createdAt) return 0;
    return (Date.now() - ticket.createdAt) / 60000;
}

/**
 * Check if ticket should be expired
 * @param {Object} ticket - Ticket object
 * @param {number} maxAgeMinutes - Maximum age in minutes (default 60)
 * @returns {boolean}
 */
function shouldExpireTicket(ticket, maxAgeMinutes = 60) {
    const age = getTicketAgeMinutes(ticket);

    // Don't expire completed or in-progress tickets
    if (ticket.state === STATES.GAME_COMPLETE ||
        ticket.state === STATES.GAME_IN_PROGRESS) {
        return false;
    }

    return age > maxAgeMinutes;
}

module.exports = {
    validateTicket,
    validateTransition,
    verifyTicketOwnership,
    isTicketChannelName,
    getTicketAgeMinutes,
    shouldExpireTicket,
    VALID_TRANSITIONS,
    TICKET_PATTERNS
};
