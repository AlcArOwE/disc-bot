/**
 * State Machine Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { TicketStateMachine, STATES } = require('../src/state/StateMachine');
const { TicketManager } = require('../src/state/TicketManager');

describe('TicketStateMachine', () => {
    let machine;

    beforeEach(() => {
        machine = new TicketStateMachine('test-channel-123', {
            opponentId: 'user-456',
            opponentBet: 15,
            ourBet: 17.25
        });
    });

    describe('initial state', () => {
        it('should start in AWAITING_TICKET state', () => {
            assert.strictEqual(machine.getState(), STATES.AWAITING_TICKET);
        });

        it('should have correct initial data', () => {
            assert.strictEqual(machine.data.opponentId, 'user-456');
            assert.strictEqual(machine.data.opponentBet, 15);
            assert.strictEqual(machine.data.ourBet, 17.25);
        });
    });

    describe('transitions', () => {
        it('should allow valid transition to AWAITING_MIDDLEMAN', () => {
            const success = machine.transition(STATES.AWAITING_MIDDLEMAN);
            assert.strictEqual(success, true);
            assert.strictEqual(machine.getState(), STATES.AWAITING_MIDDLEMAN);
        });

        it('should reject invalid transition', () => {
            const success = machine.transition(STATES.GAME_IN_PROGRESS);
            assert.strictEqual(success, false);
            assert.strictEqual(machine.getState(), STATES.AWAITING_TICKET);
        });

        it('should allow transition to CANCELLED from any state', () => {
            const success = machine.transition(STATES.CANCELLED);
            assert.strictEqual(success, true);
            assert.strictEqual(machine.getState(), STATES.CANCELLED);
        });

        it('should record transition history', () => {
            machine.transition(STATES.AWAITING_MIDDLEMAN);
            machine.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: 'mm-123' });

            assert.strictEqual(machine.history.length, 2);
            assert.strictEqual(machine.history[0].to, STATES.AWAITING_MIDDLEMAN);
            assert.strictEqual(machine.history[1].data.middlemanId, 'mm-123');
        });
    });

    describe('completion', () => {
        it('should recognize GAME_COMPLETE as terminal', () => {
            machine.transition(STATES.AWAITING_MIDDLEMAN);
            machine.transition(STATES.AWAITING_PAYMENT_ADDRESS);
            machine.transition(STATES.PAYMENT_SENT);
            machine.transition(STATES.AWAITING_GAME_START);
            machine.transition(STATES.GAME_IN_PROGRESS);
            machine.transition(STATES.GAME_COMPLETE);

            assert.strictEqual(machine.isComplete(), true);
        });

        it('should recognize CANCELLED as terminal', () => {
            machine.transition(STATES.CANCELLED);
            assert.strictEqual(machine.isComplete(), true);
        });
    });

    describe('serialization', () => {
        it('should serialize and deserialize correctly', () => {
            machine.transition(STATES.AWAITING_MIDDLEMAN);
            machine.updateData({ testField: 'testValue' });

            const json = machine.toJSON();
            const restored = TicketStateMachine.fromJSON(json);

            assert.strictEqual(restored.channelId, 'test-channel-123');
            assert.strictEqual(restored.getState(), STATES.AWAITING_MIDDLEMAN);
            assert.strictEqual(restored.data.testField, 'testValue');
            assert.strictEqual(restored.history.length, 1);
        });
    });
});

describe('TicketManager', () => {
    let manager;

    beforeEach(() => {
        manager = new TicketManager();
    });

    describe('ticket management', () => {
        it('should create tickets', () => {
            const ticket = manager.createTicket('channel-1', {
                opponentId: 'user-1',
                opponentBet: 10,
                ourBet: 11.50
            });

            assert.notStrictEqual(ticket, undefined);
            assert.strictEqual(manager.getTicket('channel-1'), ticket);
        });

        it('should find tickets by user', () => {
            manager.createTicket('channel-1', { opponentId: 'user-1' });

            const found = manager.getTicketByUser('user-1');
            assert.notStrictEqual(found, undefined);
            assert.strictEqual(found.data.opponentId, 'user-1');
        });

        it('should detect user in active ticket', () => {
            manager.createTicket('channel-1', { opponentId: 'user-1' });

            assert.strictEqual(manager.isUserInActiveTicket('user-1'), true);
            assert.strictEqual(manager.isUserInActiveTicket('user-2'), false);
        });

        it('should remove tickets', () => {
            manager.createTicket('channel-1', { opponentId: 'user-1' });
            manager.removeTicket('channel-1');

            assert.strictEqual(manager.getTicket('channel-1'), undefined);
            assert.strictEqual(manager.getTicketByUser('user-1'), undefined);
        });

        it('should maintain userIndex correctly on cleanup', () => {
            const ticket = manager.createTicket('channel-1', { opponentId: 'user-1' });
            ticket.transition(STATES.CANCELLED);

            // Advance time to allow cleanup (mocking Date.now would be better but simple enough here)
            // Instead we pass -1 maxAge to force cleanup
            manager.cleanupOldTickets(-1);

            assert.strictEqual(manager.getTicket('channel-1'), undefined);
            assert.strictEqual(manager.getTicketByUser('user-1'), undefined);
        });
    });

    describe('cooldowns', () => {
        it('should set and check cooldowns', () => {
            manager.setCooldown('user-1');
            assert.strictEqual(manager.isOnCooldown('user-1'), true);
            assert.strictEqual(manager.isOnCooldown('user-2'), false);
        });

        it('should clear cooldowns', () => {
            manager.setCooldown('user-1');
            manager.clearCooldown('user-1');
            assert.strictEqual(manager.isOnCooldown('user-1'), false);
        });
    });

    describe('stats', () => {
        it('should report correct statistics', () => {
            manager.createTicket('ch-1', { opponentId: 'u-1' });
            manager.createTicket('ch-2', { opponentId: 'u-2' });

            const stats = manager.getStats();
            assert.strictEqual(stats.total, 2);
            assert.strictEqual(stats.active, 2);
        });
    });

    describe('persistence handling', () => {
        it('should clear paymentLocked flag on restore', () => {
            const ticket = new TicketStateMachine('ch-1', { paymentLocked: true, opponentId: 'u-1' });
            const data = [ticket.toJSON()];

            manager.fromJSON(data);

            const restored = manager.getTicket('ch-1');
            assert.strictEqual(restored.data.paymentLocked, false);
        });

        it('should rebuild userIndex on restore', () => {
            const ticket = new TicketStateMachine('ch-1', { opponentId: 'u-1' });
            const data = [ticket.toJSON()];

            manager.fromJSON(data);

            const restored = manager.getTicketByUser('u-1');
            assert.notStrictEqual(restored, undefined);
            assert.strictEqual(restored.channelId, 'ch-1');
        });
    });
});
