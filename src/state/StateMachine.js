/**
 * State Machine - Manages ticket lifecycle phases
 */

const { logger } = require('../utils/logger');

// Ticket lifecycle states
const STATES = {
    AWAITING_TICKET: 'AWAITING_TICKET',
    AWAITING_MIDDLEMAN: 'AWAITING_MIDDLEMAN',
    AWAITING_PAYMENT_ADDRESS: 'AWAITING_PAYMENT_ADDRESS',
    PAYMENT_SENT: 'PAYMENT_SENT',
    AWAITING_GAME_START: 'AWAITING_GAME_START',
    GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
    AWAITING_PAYOUT: 'AWAITING_PAYOUT',
    GAME_COMPLETE: 'GAME_COMPLETE',
    CANCELLED: 'CANCELLED'
};

// Valid state transitions
const TRANSITIONS = {
    [STATES.AWAITING_TICKET]: [STATES.AWAITING_MIDDLEMAN, STATES.CANCELLED],
    [STATES.AWAITING_MIDDLEMAN]: [STATES.AWAITING_PAYMENT_ADDRESS, STATES.CANCELLED],
    [STATES.AWAITING_PAYMENT_ADDRESS]: [STATES.PAYMENT_SENT, STATES.CANCELLED],
    [STATES.PAYMENT_SENT]: [STATES.AWAITING_GAME_START, STATES.CANCELLED],
    [STATES.AWAITING_GAME_START]: [STATES.GAME_IN_PROGRESS, STATES.CANCELLED],
    [STATES.GAME_IN_PROGRESS]: [STATES.GAME_COMPLETE, STATES.AWAITING_PAYOUT, STATES.CANCELLED],
    [STATES.AWAITING_PAYOUT]: [STATES.GAME_COMPLETE, STATES.CANCELLED],
    [STATES.GAME_COMPLETE]: [],
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
            payoutTxId: null,
            payoutAmount: 0,
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
        
        return true;
    }
    
    /**
     * Update data without changing state
     * @param {object} newData - Data to merge
     */
    updateData(newData) {
        Object.assign(this.data, newData);
        this.updatedAt = Date.now();
    }
    
    /**
     * Check if ticket is in a terminal state
     * @returns {boolean}
     */
    isComplete() {
        return [STATES.GAME_COMPLETE, STATES.CANCELLED].includes(this.state);
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
