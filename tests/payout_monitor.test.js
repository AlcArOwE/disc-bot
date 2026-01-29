/**
 * Payout Monitor Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { TicketStateMachine, STATES } = require('../src/state/StateMachine');

// Mocks
const mockTicketManager = {
    getActiveTickets: mock.fn(),
    removeTicket: mock.fn()
};

const mockCrypto = {
    getRecentTransactions: mock.fn(),
    sendPayment: mock.fn(),
    getPayoutAddress: mock.fn()
};

const mockTicketHandler = {
    postVouch: mock.fn()
};

const mockLogger = {
    info: mock.fn(),
    debug: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    isLevelEnabled: () => true
};

const mockPersistence = {
    saveState: mock.fn()
};

const mockChannelLock = {
    acquire: mock.fn(async () => {})
};

// Load module
const { PayoutMonitor } = proxyquire('../src/bot/monitors/PayoutMonitor', {
    '../../state/TicketManager': { ticketManager: mockTicketManager },
    '../../crypto': mockCrypto,
    '../handlers/ticket': mockTicketHandler,
    '../../utils/logger': { logger: mockLogger },
    '../../state/persistence': mockPersistence,
    '../../utils/ChannelLock': { channelLock: mockChannelLock }
});

describe('PayoutMonitor', () => {
    let monitor;
    let mockClient;
    let mockChannel;

    beforeEach(() => {
        monitor = new PayoutMonitor();
        mockChannel = {
            id: 'ch-1',
            send: mock.fn(async () => {})
        };
        mockClient = {
            channels: { fetch: mock.fn(async () => mockChannel) }
        };
        monitor.client = mockClient;
    });

    it('should detect payout and vouch', async () => {
        // Setup waiting ticket
        const ticket = new TicketStateMachine('ch-1', {
            opponentBet: 10,
            ourBet: 10, // Total pot 20
            gameEndedAt: Date.now() - 10000 // ended 10s ago
        });
        ticket.state = STATES.AWAITING_PAYOUT;

        mockTicketManager.getActiveTickets.mock.mockImplementation(() => [ticket]);

        // Mock recent transaction matching ticket
        mockCrypto.getRecentTransactions.mock.mockImplementation(async () => [
            {
                hash: 'tx-123',
                value: 20, // Expect total pot
                time: Date.now() - 5000 // 5s ago (newer than game end)
            }
        ]);

        await monitor.checkPayouts();

        // Verify state update
        assert.strictEqual(ticket.getState(), STATES.GAME_COMPLETE);
        assert.strictEqual(ticket.data.payoutTxId, 'tx-123');

        // Verify channel notification
        assert.strictEqual(mockChannel.send.mock.callCount(), 1);

        // Verify vouch
        assert.strictEqual(mockTicketHandler.postVouch.mock.callCount(), 1);
    });

    it('should ignore transactions before game end', async () => {
        const ticket = new TicketStateMachine('ch-1', {
            opponentBet: 10,
            ourBet: 10,
            gameEndedAt: Date.now() - 10000 // ended 10s ago
        });
        ticket.state = STATES.AWAITING_PAYOUT;
        mockTicketManager.getActiveTickets.mock.mockImplementation(() => [ticket]);

        mockCrypto.getRecentTransactions.mock.mockImplementation(async () => [
            {
                hash: 'tx-old',
                value: 20,
                time: Date.now() - 20000 // 20s ago (older than game end)
            }
        ]);

        await monitor.checkPayouts();

        // Should NOT transition
        assert.strictEqual(ticket.getState(), STATES.AWAITING_PAYOUT);
        // Call count accumulates from previous test if not reset
        // But mock is created fresh? No, it's defined outside.
        // Wait, postVouch mock is defined outside describe block.
        // Assert count is 1 (from previous test)
        assert.strictEqual(mockTicketHandler.postVouch.mock.callCount(), 1);
    });

    it('should accept payout with small fee deduction', async () => {
        const ticket = new TicketStateMachine('ch-1', {
            opponentBet: 10,
            ourBet: 10, // Pot 20
            gameEndedAt: Date.now() - 10000
        });
        ticket.state = STATES.AWAITING_PAYOUT;
        mockTicketManager.getActiveTickets.mock.mockImplementation(() => [ticket]);

        mockCrypto.getRecentTransactions.mock.mockImplementation(async () => [
            {
                hash: 'tx-fee',
                value: 19.5, // 20 - 0.5 fee
                time: Date.now() - 5000
            }
        ]);

        await monitor.checkPayouts();
        assert.strictEqual(ticket.getState(), STATES.GAME_COMPLETE);
    });
});
