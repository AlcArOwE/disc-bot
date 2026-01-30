/**
 * Autonomous Flow Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { TicketStateMachine, STATES } = require('../src/state/StateMachine');

// Mocks
const mockTicketManager = {
    getTicket: mock.fn(),
    createTicket: mock.fn(),
    userIndex: new Map(),
    setCooldown: mock.fn(),
    getTicketByUser: mock.fn(),
    isUserInActiveTicket: mock.fn(() => false),
    isOnCooldown: mock.fn(() => false)
};

const mockPersistence = {
    saveState: mock.fn(async () => true)
};

const mockConfig = {
    game_settings: { dice_command: '!dice' },
    response_templates: {
        payment_sent: 'Sent',
        bet_offer: 'vs my {calculated}'
    },
    tax_percentage: 0.1,
    middleman_ids: ['mm-1']
};

const mockLogger = {
    info: mock.fn(),
    debug: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    isLevelEnabled: () => true
};

const mockDiceEngine = {
    roll: mock.fn(() => 5),
    formatResult: (r) => `[${r}]`
};

// Utils
const mockDelay = {
    humanDelay: async () => {},
    gameActionDelay: async () => {}
};

// Load Handlers
const ticketHandler = proxyquire('../src/bot/handlers/ticket', {
    '../../state/TicketManager': { ticketManager: mockTicketManager },
    '../../state/persistence': mockPersistence,
    '../../../config.json': mockConfig,
    '../../utils/logger': { logger: mockLogger, logGame: mock.fn() },
    '../../game/DiceEngine': mockDiceEngine,
    '../../utils/delay': mockDelay,
    '../../utils/notifier': { logGameResult: mock.fn(), logPayment: mock.fn() },
    '../../crypto': { sendPayment: async () => ({ success: true, txId: 'tx1' }), getPayoutAddress: () => 'addr1' },
    '../../utils/validator': { isMiddleman: (id) => id === 'mm-1', validatePaymentAddress: () => ({ valid: true }) }
});

describe('Autonomous Flow', () => {
    let mockChannel;
    let mockTicket;

    beforeEach(() => {
        mockChannel = {
            id: 'ch-auto',
            name: 'ticket-001',
            send: mock.fn(async () => {}),
            reply: mock.fn(async () => {}),
            client: { user: { id: 'bot-id' } }
        };

        // Reset mocks
        mockTicketManager.getTicket.mock.resetCalls();
        mockTicketManager.createTicket.mock.resetCalls();
        mockPersistence.saveState.mock.resetCalls();
        mockLogger.info.mock.resetCalls();
    });

    it('Should latch onto opponent if ticket exists but has no opponentId', async () => {
        // Setup existing "empty" ticket (simulating channelCreate)
        mockTicket = new TicketStateMachine('ch-auto', {
            opponentId: null,
            opponentBet: 0,
            ourBet: 0
        });
        mockTicket.transition(STATES.AWAITING_MIDDLEMAN); // as per channelCreate logic

        // Mock getTicket to return this ticket
        mockTicketManager.getTicket.mock.mockImplementation(() => mockTicket);

        // Mock updateData to update local object
        mockTicket.updateData = mock.fn((data) => Object.assign(mockTicket.data, data));

        // Message from user
        const msg = {
            channel: mockChannel,
            author: { id: 'user-123', bot: false },
            content: 'hello',
            reply: mockChannel.reply,
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(msg);

        // Verify latching
        assert.strictEqual(mockTicket.data.opponentId, 'user-123', 'Should set opponentId');
        assert.strictEqual(mockTicket.data.announcedLatch, true, 'Should mark announced');

        // Verify notification
        assert.strictEqual(mockChannel.reply.mock.callCount(), 1);
        assert.match(mockChannel.reply.mock.calls[0].arguments[0], /Ticket initialized/);

        // Verify state save
        assert.ok(mockPersistence.saveState.mock.callCount() >= 1);

        // Verify logger
        const logCalls = mockLogger.info.mock.calls.map(c => c.arguments[0]);
        assert.ok(logCalls.some(l => l.includes('Latched onto opponent')));
    });

    it('Should NOT latch onto middleman', async () => {
        mockTicket = new TicketStateMachine('ch-auto', { opponentId: null });
        mockTicketManager.getTicket.mock.mockImplementation(() => mockTicket);

        const msg = {
            channel: mockChannel,
            author: { id: 'mm-1', bot: false }, // mm-1 is middleman in config
            content: 'hello',
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(msg);

        assert.strictEqual(mockTicket.data.opponentId, null, 'Should not latch onto middleman');
    });
});
