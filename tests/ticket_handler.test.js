/**
 * Ticket Handler Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

// Mocks
const mockTicketManager = {
    getTicket: mock.fn(),
    createTicket: mock.fn(),
    removeTicket: mock.fn()
};

const mockPersistence = {
    saveState: mock.fn()
};

const mockConfig = {
    game_settings: { dice_command: '!dice' },
    response_templates: { payment_sent: 'Sent' }
};

const mockLogger = {
    info: mock.fn(),
    debug: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    isLevelEnabled: () => true
};

const mockDiceEngine = {
    roll: mock.fn(() => 5), // Always roll 5
    formatResult: (r) => `[${r}]`
};

// We need a real ScoreTracker for logic
const ScoreTracker = require('../src/game/ScoreTracker');

// Load handler with mocks
const ticketHandler = proxyquire('../src/bot/handlers/ticket', {
    '../../state/TicketManager': { ticketManager: mockTicketManager },
    '../../state/persistence': mockPersistence,
    '../../../config.json': mockConfig,
    '../../utils/logger': { logger: mockLogger, logGame: mock.fn() },
    '../../game/DiceEngine': mockDiceEngine,
    '../../utils/delay': { humanDelay: async () => {}, gameActionDelay: async () => {} },
    '../../utils/notifier': { logGameResult: mock.fn(), logPayment: mock.fn() },
    '../../crypto': { sendPayment: async () => ({ success: true, txId: 'tx1' }), getPayoutAddress: () => 'addr1' }
});

describe('Ticket Handler Logic', () => {
    let mockChannel;
    let mockTicket;

    beforeEach(() => {
        mockChannel = {
            id: 'ch-1',
            send: mock.fn(async () => {}),
            client: { user: { id: 'bot-id' } }
        };

        mockTicket = {
            channelId: 'ch-1',
            data: {
                opponentId: 'opp-1',
                trackerState: null,
                gameScores: { bot: 0, opponent: 0 }
            },
            getState: () => 'GAME_IN_PROGRESS',
            updateData: mock.fn((data) => Object.assign(mockTicket.data, data)),
            transition: mock.fn()
        };

        mockTicketManager.getTicket.mock.mockImplementation(() => mockTicket);
        mockDiceEngine.roll.mock.mockImplementation(() => 5);
    });

    it('Scenario 1: Bot initiates roll', async () => {
        // Initialize tracker state so handleGameInProgress can restore it
        mockTicket.data.trackerState = new ScoreTracker('ch-1').toJSON();

        mockTicket.data.middlemanId = 'mm-1';
        const msg = {
            channel: mockChannel,
            author: { id: 'mm-1' },
            content: 'roll dice',
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(msg);

        // Check if bot rolled and stored it
        // Since we can't inspect internal map, we check side effects

        // 1. Should have sent "I rolled [5]"
        assert.strictEqual(mockChannel.send.mock.callCount(), 1);
        assert.match(mockChannel.send.mock.calls[0].arguments[0], /I rolled/);

        // 2. Should have updated ticket data with trackerState
        assert.strictEqual(mockTicket.updateData.mock.callCount(), 1);
        assert.ok(mockTicket.data.trackerState);
        assert.strictEqual(mockTicket.data.trackerState.pendingBotRoll, 5);

        // 3. Should have saved state
        assert.strictEqual(mockPersistence.saveState.mock.callCount(), 1);
    });

    it('Scenario 2: Bot responds to opponent roll using pending roll', async () => {
        // Setup pending roll
        const tracker = new ScoreTracker('ch-1');
        tracker.pendingBotRoll = 6;
        mockTicket.data.trackerState = tracker.toJSON();

        // Msg from opponent with roll result
        const msg = {
            channel: mockChannel,
            author: { id: 'opp-1' },
            content: 'rolled 4', // regex should pick 4
            client: { user: { id: 'bot-id' } }
        };

        // Mock extractDiceResult via proxyquire or just assume logic works if regex is correct
        // But we didn't mock regex.js, so it uses real one.

        await ticketHandler.handleMessage(msg);

        // Should use pending roll (6) vs opponent (4) -> Bot wins
        // 1. Announce result "6 vs 4 - I win!"
        // 2. Since game continues, it should IMMEDIATELY roll again for next round

        // calls: [Result Msg, Next Round Roll Msg]
        assert.ok(mockChannel.send.mock.callCount() >= 2);

        const calls = mockChannel.send.mock.calls;
        const resultMsg = calls.find(c => c.arguments[0].includes('I win'));
        assert.ok(resultMsg, 'Should announce win');

        const nextRollMsg = calls.find(c => c.arguments[0].includes('I rolled'));
        assert.ok(nextRollMsg, 'Should announce next roll');

        // Verify state update
        assert.ok(mockTicket.data.trackerState.pendingBotRoll); // Should have new pending roll
    });

    it('Recovery: Should restore tracker from state', async () => {
        const tracker = new ScoreTracker('ch-1');
        tracker.scores.bot = 2;
        mockTicket.data.trackerState = tracker.toJSON();

        // Force internal map to be empty (new instance of handler logic effectively)
        // But since we can't clear the map in the required module...
        // The test runner isolates modules if we require them fresh? No.
        // But we handle it in code: `if (!tracker && ticket.data.trackerState)`

        const msg = {
            channel: mockChannel,
            author: { id: 'opp-1' },
            content: 'rolled 1',
            client: { user: { id: 'bot-id' } }
        };

        await ticketHandler.handleMessage(msg);

        // If recovery worked, it processed the roll
        assert.ok(mockChannel.send.mock.callCount() >= 1);
    });
});
