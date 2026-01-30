/**
 * Robustness Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

// Mocks
const mockTicketManager = {
    getTicket: mock.fn(),
    createTicket: mock.fn(),
    userIndex: new Map(),
    setCooldown: mock.fn(),
    getTicketByUser: mock.fn()
};

const mockCrypto = {
    getBalance: mock.fn()
};

const mockConfig = {
    simulation_mode: false,
    game_settings: { dice_command: '!dice' },
    response_templates: { bet_offer: 'vs {calculated}' },
    tax_percentage: 0.1
};

const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    isLevelEnabled: () => true
};

const mockDelay = { humanDelay: async () => {}, gameActionDelay: async () => {} };

// Load handlers
const ticketHandler = proxyquire('../src/bot/handlers/ticket', {
    '../../state/TicketManager': { ticketManager: mockTicketManager },
    '../../crypto': mockCrypto,
    '../../../config.json': mockConfig,
    '../../utils/logger': { logger: mockLogger, logGame: mock.fn() },
    '../../utils/delay': mockDelay,
    '../../utils/betting': { calculateOurBet: (bet) => (bet * 1.1).toFixed(2) },
    '../../utils/ChannelLock': { channelLock: { acquire: async () => {} } }
});

describe('Robustness Checks', () => {
    let mockChannel;
    let mockTicket;

    beforeEach(() => {
        mockChannel = {
            id: 'ch-robust',
            name: 'ticket-1',
            messages: { fetch: mock.fn(async () => []) },
            send: mock.fn(async () => {}),
            reply: mock.fn(async () => {})
        };

        // Reset mocks
        mockTicketManager.getTicket.mock.resetCalls();
        mockTicketManager.createTicket.mock.resetCalls();
    });

    it('Should reject latching if wallet balance is insufficient', async () => {
        // Setup low balance
        mockCrypto.getBalance.mock.mockImplementation(async () => ({ balance: 0.5 })); // Has 0.5

        // Mock ticket creation return (even if not saved yet)
        mockTicket = {
            data: { opponentId: null },
            updateData: mock.fn(),
            getState: () => 'AWAITING_TICKET',
            transition: mock.fn()
        };
        mockTicketManager.createTicket.mock.mockImplementation(() => mockTicket);
        mockTicketManager.getTicket.mock.mockImplementation(() => undefined); // First call returns undefined, then creates

        // Setup channel history with a bet of 10
        const betMsg = {
            author: { id: 'user-rich' },
            content: '10v10',
            channel: mockChannel
        };
        const messages = new Map([['1', betMsg]]);
        messages.filter = (fn) => new Map([...messages].filter(([k,v]) => fn(v)));

        mockChannel.messages.fetch.mock.mockImplementation(async () => messages);

        // Required balance: 10 * 1.1 = 11. Actual: 0.5. Should fail.

        const msg = {
            channel: mockChannel,
            author: { id: 'user-rich', bot: false },
            content: 'hi',
            reply: mockChannel.reply
        };

        await ticketHandler.handleMessage(msg);

        // Verify rejection
        assert.match(mockChannel.reply.mock.calls[0].arguments[0], /Insufficient funds/);

        // Verify ticket NOT updated with bet
        // The updateData might be called for opponentId, but NOT for bet amounts?
        // Actually, handleLatchOpponent returns false/aborts if balance check fails?
        // Wait, current implementation: "return false // Abort latching" inside the history scan loop if found.

        // Check logs
        assert.ok(mockLogger.warn.mock.calls.some(c => c.arguments[0].includes('Insufficient balance')));
    });
});
