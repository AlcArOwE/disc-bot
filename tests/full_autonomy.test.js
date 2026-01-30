/**
 * Full Autonomy Tests
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
    tax_percentage: 0.2, // 20%
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

describe('Full Autonomy Flow', () => {
    let mockChannel;
    let mockTicket;

    beforeEach(() => {
        mockChannel = {
            id: 'ch-full-auto',
            name: 'ticket-auto',
            send: mock.fn(async () => {}),
            reply: mock.fn(async () => {}),
            messages: {
                fetch: mock.fn(async () => [])
            },
            client: { user: { id: 'bot-id' } }
        };

        mockTicketManager.getTicket.mock.resetCalls();
        mockTicketManager.createTicket.mock.resetCalls();
    });

    it('Should auto-detect bet amounts from history when latching', async () => {
        // Setup existing "empty" ticket
        mockTicket = new TicketStateMachine('ch-full-auto', { opponentId: null });
        mockTicketManager.getTicket.mock.mockImplementation(() => mockTicket);
        mockTicket.updateData = mock.fn((data) => Object.assign(mockTicket.data, data));

        // Mock channel history with a bet
        const betMsg = {
            author: { id: 'user-auto' },
            content: 'I bet 10v10',
            channel: mockChannel
        };

        // Mock collection behavior of Discord.js
        const messages = new Map();
        messages.set('msg-1', betMsg);
        // Add filter method to the map (mimic Collection)
        messages.filter = (fn) => {
            const filtered = new Map();
            for (const [key, val] of messages) {
                if (fn(val)) filtered.set(key, val);
            }
            return filtered;
        };

        mockChannel.messages.fetch.mock.mockImplementation(async () => messages);

        // Latch trigger message
        const triggerMsg = {
            channel: mockChannel,
            author: { id: 'user-auto', bot: false },
            content: 'hello',
            reply: mockChannel.reply,
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(triggerMsg);

        // Verify latch
        assert.strictEqual(mockTicket.data.opponentId, 'user-auto');

        // Verify auto-bet detection
        assert.strictEqual(mockTicket.data.opponentBet, 10);
        // Our bet = 10 * 1.2 = 12
        assert.strictEqual(mockTicket.data.ourBet, 12);

        // Verify notification contains bet info
        assert.match(mockChannel.reply.mock.calls[0].arguments[0], /10 vs \$12/);
    });

    it('Should handle "Ask and Ignore" scenario (0 bet -> user response)', async () => {
        // Setup ticket with 0 bet (failed history scan)
        mockTicket = new TicketStateMachine('ch-full-auto', { opponentId: 'user-auto', opponentBet: 0 });
        mockTicketManager.getTicket.mock.mockImplementation(() => mockTicket);
        mockTicket.updateData = mock.fn((data) => Object.assign(mockTicket.data, data));

        // User responds with bet
        const msg = {
            channel: mockChannel,
            author: { id: 'user-auto', bot: false },
            content: '10v10',
            reply: mockChannel.reply,
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(msg);

        // Verify update
        assert.strictEqual(mockTicket.data.opponentBet, 10);
        assert.strictEqual(mockTicket.data.ourBet, 12);

        // Verify response
        assert.strictEqual(mockChannel.reply.mock.callCount(), 1);
        assert.match(mockChannel.reply.mock.calls[0].arguments[0], /Bet updated/);
    });
});
