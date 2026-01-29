/**
 * Autonomous Flow Tests
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { ticketManager } = require('../src/state/TicketManager');
const ticketHandler = require('../src/bot/handlers/ticket');
const { STATES } = require('../src/state/StateMachine');
const ScoreTracker = require('../src/game/ScoreTracker');

// Mock dependencies (logger, persistence) to avoid side effects
// (Simplified for this test environment, relying on existing mocks if any or direct execution)

describe('Autonomous Flow Verification', () => {

    beforeEach(() => {
        // Clear ticket manager before each test
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();
        ticketManager.cooldowns.clear();
    });

    it('should auto-detect ticket and latch opponent from "10v10" message', async () => {
        const channelId = 'ticket-123';
        const userId = 'user-555';

        const mockMessage = {
            channel: {
                id: channelId,
                name: 'ticket-123',
                send: async () => {},
                reply: async () => {}
            },
            author: {
                id: userId,
                bot: false
            },
            content: '10v10',
            reply: async () => {} // mocking reply
        };

        // Execute the handler
        const handled = await ticketHandler.handleMessage(mockMessage);

        assert.strictEqual(handled, true, 'Should have handled the message');

        // Verify ticket creation
        const ticket = ticketManager.getTicket(channelId);
        assert.ok(ticket, 'Ticket should be created');
        assert.strictEqual(ticket.data.opponentId, userId, 'Opponent ID should be latched');
        assert.strictEqual(ticket.data.opponentBet, 10, 'Opponent bet should be 10');

        // Verify user index
        const userTicket = ticketManager.getTicketByUser(userId);
        assert.strictEqual(userTicket, ticket, 'O(1) User lookup should work');

        // Verify State
        // createTicket transitions to AWAITING_MIDDLEMAN
        assert.strictEqual(ticket.getState(), STATES.AWAITING_MIDDLEMAN);
    });

    it('should parse complex bet strings', async () => {
        const mockMessage = {
            channel: {
                id: 'wager-456',
                name: 'wager-456',
                send: async () => {},
                reply: async () => {}
            },
            author: { id: 'user-777', bot: false },
            content: 'I want to bet 15.50 vs 15.50 please',
            reply: async () => {}
        };

        await ticketHandler.handleMessage(mockMessage);
        const ticket = ticketManager.getTicket('wager-456');

        assert.ok(ticket);
        assert.strictEqual(ticket.data.opponentBet, 15.5);
    });

    it('should NOT create ticket for random messages in ticket channel', async () => {
        const mockMessage = {
            channel: {
                id: 'ticket-999',
                name: 'ticket-999',
                send: async () => {},
                reply: async () => {}
            },
            author: { id: 'user-888', bot: false },
            content: 'hello world',
            reply: async () => {}
        };

        const handled = await ticketHandler.handleMessage(mockMessage);
        assert.strictEqual(handled, false);
        assert.strictEqual(ticketManager.getTicket('ticket-999'), undefined);
    });

    it('should persist pending bot roll', () => {
        const tracker = new ScoreTracker('ch-1');
        tracker.setPendingBotRoll(6);

        const json = tracker.toJSON();
        const restored = ScoreTracker.fromJSON(json);

        assert.strictEqual(restored.pendingBotRoll, 6);
    });
});
