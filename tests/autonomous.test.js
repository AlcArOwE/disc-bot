
const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ticketManager } = require('../src/state/TicketManager');
const ticketHandler = require('../src/bot/handlers/ticket');
const { STATES } = require('../src/state/StateMachine');

// Mock dependencies
const logger = require('../src/utils/logger').logger;
mock.method(logger, 'info', () => {});
mock.method(logger, 'warn', () => {});
mock.method(logger, 'debug', () => {});
mock.method(logger, 'error', () => {});

const persistence = require('../src/state/persistence');
mock.method(persistence, 'saveState', async () => true);

const delay = require('../src/utils/delay');
mock.method(delay, 'humanDelay', async () => {});
mock.method(delay, 'gameActionDelay', async () => {});

describe('Autonomous Logic', () => {
    beforeEach(() => {
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();
    });

    describe('Opponent Latching', () => {
        it('should create ticket on channel detection and latch opponent', async () => {
            const channelId = 'ticket-channel-1';
            const userId = 'user-1';

            // 1. User sends message in new ticket channel
            const msg1 = {
                channel: { id: channelId, name: 'ticket-123', send: async () => {} },
                author: { id: userId, bot: false },
                content: 'I want to bet 10',
                reply: async () => {}
            };

            // First message creates ticket and latches (since we process it immediately)
            await ticketHandler.handleMessage(msg1);

            const ticket = ticketManager.getTicket(channelId);
            assert.ok(ticket, 'Ticket should be created');
            assert.strictEqual(ticket.data.opponentId, userId, 'Opponent should be latched');
            assert.strictEqual(ticket.getState(), STATES.AWAITING_MIDDLEMAN, 'Should transition to AWAITING_MIDDLEMAN');

            // Verify userIndex
            const indexTicket = ticketManager.getTicketByUser(userId);
            assert.strictEqual(indexTicket, ticket, 'User index should be updated');
        });

        it('should not latch bot or middleman', async () => {
            const channelId = 'ticket-channel-2';
            const botId = 'bot-1';

            const msgBot = {
                channel: { id: channelId, name: 'ticket-456', send: async () => {} },
                author: { id: botId, bot: true },
                content: 'Hello'
            };

            await ticketHandler.handleMessage(msgBot);
            let ticket = ticketManager.getTicket(channelId);

            // Bot message creates ticket (detected) but does NOT latch opponent
            assert.ok(ticket, 'Ticket created');
            assert.strictEqual(ticket.data.opponentId, null, 'Bot should not be latched');

            // Now user joins
            const userId = 'real-user';
            const msgUser = {
                channel: { id: channelId, name: 'ticket-456', send: async () => {} },
                author: { id: userId, bot: false },
                content: 'Hi'
            };

            await ticketHandler.handleMessage(msgUser);
            ticket = ticketManager.getTicket(channelId);
            assert.strictEqual(ticket.data.opponentId, userId, 'User should be latched');
        });
    });
});
