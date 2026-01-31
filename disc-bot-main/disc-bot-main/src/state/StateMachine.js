/**
 * State Machine - Manages ticket lifecycle phases
 */

const { logger } = require('../utils/logger');

// Ticket lifecycle states (per master prompt specification)
const STATES = {
    // Initial state when snipe is made
    WAITING_FOR_TICKET_LINK: 'WAITING_FOR_TICKET_LINK',

    // Legacy states for backwards compatibility
    AWAITING_TICKET: 'AWAITING_TICKET',
    AWAITING_WAGER_CLARIFICATION: 'AWAITING_WAGER_CLARIFICATION',
    AWAITING_MIDDLEMAN: 'AWAITING_MIDDLEMAN',

    // Payment flow
    WAITING_FOR_DEPOSIT_ADDRESS: 'WAITING_FOR_DEPOSIT_ADDRESS',
    AWAITING_PAYMENT_ADDRESS: 'AWAITING_PAYMENT_ADDRESS', // Alias for backwards compat
    PAYMENT_SENT: 'PAYMENT_SENT',

    // Bet confirmation
    WAITING_FOR_BET_CONFIRMATION: 'WAITING_FOR_BET_CONFIRMATION',

    // Game flow
    WAITING_FOR_GAME_START: 'WAITING_FOR_GAME_START',
    AWAITING_GAME_START: 'AWAITING_GAME_START', // Alias
    WAITING_FOR_OUR_TURN: 'WAITING_FOR_OUR_TURN',
    ROLL_SENT: 'ROLL_SENT',
    WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
    GAME_IN_PROGRESS: 'GAME_IN_PROGRESS', // Legacy

    // Terminal states
    GAME_COMPLETE: 'GAME_COMPLETE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
};

// Valid state transitions (comprehensive flow)
const TRANSITIONS = {
    // New flow per master prompt
    [STATES.WAITING_FOR_TICKET_LINK]: [STATES.WAITING_FOR_DEPOSIT_ADDRESS, STATES.AWAITING_MIDDLEMAN, STATES.CANCELLED],
    [STATES.WAITING_FOR_DEPOSIT_ADDRESS]: [STATES.PAYMENT_SENT, STATES.CANCELLED],
    [STATES.PAYMENT_SENT]: [STATES.WAITING_FOR_BET_CONFIRMATION, STATES.AWAITING_GAME_START, STATES.CANCELLED],
    [STATES.WAITING_FOR_BET_CONFIRMATION]: [STATES.WAITING_FOR_GAME_START, STATES.CANCELLED],
    [STATES.WAITING_FOR_GAME_START]: [STATES.WAITING_FOR_OUR_TURN, STATES.GAME_IN_PROGRESS, STATES.CANCELLED],
    [STATES.WAITING_FOR_OUR_TURN]: [STATES.ROLL_SENT, STATES.WAITING_FOR_RESULT, STATES.GAME_COMPLETE, STATES.CANCELLED],
    [STATES.ROLL_SENT]: [STATES.WAITING_FOR_RESULT, STATES.WAITING_FOR_OUR_TURN, STATES.GAME_COMPLETE, STATES.CANCELLED],
    [STATES.WAITING_FOR_RESULT]: [STATES.WAITING_FOR_OUR_TURN, STATES.GAME_COMPLETE, STATES.COMPLETED, STATES.CANCELLED],

    // Legacy transitions for backwards compatibility
    [STATES.AWAITING_TICKET]: [STATES.AWAITING_WAGER_CLARIFICATION, STATES.AWAITING_MIDDLEMAN, STATES.WAITING_FOR_TICKET_LINK, STATES.CANCELLED],
    [STATES.AWAITING_WAGER_CLARIFICATION]: [STATES.AWAITING_MIDDLEMAN, STATES.CANCELLED],
    [STATES.AWAITING_MIDDLEMAN]: [STATES.AWAITING_PAYMENT_ADDRESS, STATES.WAITING_FOR_DEPOSIT_ADDRESS, STATES.CANCELLED],
    [STATES.AWAITING_PAYMENT_ADDRESS]: [STATES.PAYMENT_SENT, STATES.CANCELLED],
    [STATES.AWAITING_GAME_START]: [STATES.GAME_IN_PROGRESS, STATES.WAITING_FOR_OUR_TURN, STATES.CANCELLED],
    [STATES.GAME_IN_PROGRESS]: [STATES.GAME_COMPLETE, STATES.WAITING_FOR_OUR_TURN, STATES.CANCELLED],

    // Terminal states
    [STATES.GAME_COMPLETE]: [STATES.COMPLETED],
    [STATES.COMPLETED]: [],
    [STATES.CANCELLED]: []
};

/**
 * State Machine for a single ticket
 */
class TicketStateMachine {
    /**
     * @param {string} channelId - Discord channel ID (ticket)
     * @param {object} initialData - Initial ticket data
     */
    constructor(channelId, initialData = {}) {
        this.channelId = channelId;
        this.state = STATES.AWAITING_TICKET;
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
        this.history = [];

        // Ticket data
        this.data = {
            opponentId: initialData.opponentId || null,
            opponentBet: initialData.opponentBet || 0,
            ourBet: initialData.ourBet || 0,
            middlemanId: null,
            paymentAddress: null,
            paymentTxId: null,
            gameScores: { bot: 0, opponent: 0 },
            winner: null,
            ...initialData
        };
    }

    /**
     * Get current state
     * @returns {string}
     */
    getState() {
        return this.state;
    }

    /**
     * Check if transition to new state is valid
     * @param {string} newState - Target state
     * @returns {boolean}
     */
    canTransition(newState) {
        const validTransitions = TRANSITIONS[this.state] || [];
        return validTransitions.includes(newState);
    }

    /**
     * Transition to a new state
     * @param {string} newState - Target state
     * @param {object} additionalData - Data to merge
     * @returns {boolean} - Success
     */
    transition(newState, additionalData = {}) {
        if (!this.canTransition(newState)) {
            logger.warn('Invalid state transition attempted', {
                channelId: this.channelId,
                currentState: this.state,
                attemptedState: newState
            });
            return false;
        }

        const previousState = this.state;
        this.state = newState;
        this.updatedAt = Date.now();

        // Record history
        this.history.push({
            from: previousState,
            to: newState,
            timestamp: this.updatedAt,
            data: additionalData
        });

        // Merge additional data
        Object.assign(this.data, additionalData);

        logger.info('State transition', {
            channelId: this.channelId,
            from: previousState,
            to: newState
        });

        // Require here to avoid circular dependency
        const { ticketManager } = require('./TicketManager');
        ticketManager.triggerSave();

        return true;
    }

    /**
     * Update data without changing state
     * @param {object} newData - Data to merge
     */
    updateData(newData) {
        Object.assign(this.data, newData);
        this.updatedAt = Date.now();
        const { ticketManager } = require('./TicketManager');
        ticketManager.triggerSave();
    }

    /**
     * Check if ticket is in a terminal state
     * @returns {boolean}
     */
    isComplete() {
        return [STATES.GAME_COMPLETE, STATES.COMPLETED, STATES.CANCELLED].includes(this.state);
    }

    /**
     * Check if payment has been made
     * @returns {boolean}
     */
    hasPaymentBeenSent() {
        return this.data.paymentTxId !== null;
    }

    /**
     * Serialize for persistence
     * @returns {object}
     */
    toJSON() {
        return {
            channelId: this.channelId,
            state: this.state,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            history: this.history,
            data: this.data
        };
    }

    /**
     * Restore from serialized data
     * @param {object} json - Serialized state machine
     * @returns {TicketStateMachine}
     */
    static fromJSON(json) {
        const machine = new TicketStateMachine(json.channelId, json.data);
        machine.state = json.state;
        machine.createdAt = json.createdAt;
        machine.updatedAt = json.updatedAt;
        machine.history = json.history || [];
        return machine;
    }
}

module.exports = { TicketStateMachine, STATES };
