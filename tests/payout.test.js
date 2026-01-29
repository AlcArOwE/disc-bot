const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { STATES } = require('../src/state/StateMachine');

test('PayoutMonitor', async (t) => {
    // Mocks
    const tickets = [];
    const ticketManagerMock = {
        getActiveTickets: () => tickets,
        tickets: {
            entries: () => tickets.map(t => [t.channelId, t])
        }
    };

    let recentTransactions = [];
    const cryptoMock = {
        getRecentTransactions: async () => recentTransactions,
        getPayoutAddress: () => 'addr-123'
    };

    const saveStateMock = () => {};

    // Load module
    const { PayoutMonitor } = proxyquire('../src/bot/monitors/PayoutMonitor', {
        '../../state/TicketManager': { ticketManager: ticketManagerMock },
        '../../state/StateMachine': { STATES },
        '../../state/persistence': { saveState: saveStateMock },
        '../../crypto': cryptoMock,
        '../../utils/logger': { logger: { info: () => {}, error: () => {} } },
        '../handlers/ticket': { postVouch: async () => {} } // Mock postVouch import
    });

    await t.test('should verify payout and transition ticket', async () => {
        const monitor = new PayoutMonitor();
        // Shorten interval
        monitor.scanInterval = 50;

        // Setup ticket in AWAITING_PAYOUT
        const ticket = {
            channelId: 'ch-win',
            state: STATES.AWAITING_PAYOUT,
            data: { opponentBet: 10, ourBet: 10 },
            updatedAt: Date.now() - 1000, // 1 sec ago
            transition: (newState, data) => {
                ticket.state = newState;
                Object.assign(ticket.data, data);
            }
        };
        tickets.push(ticket);

        // Setup transaction
        recentTransactions = [{
            txId: 'tx-123',
            amount: 20, // 10+10
            confirmations: 1,
            timestamp: Date.now() // Now
        }];

        // Mock client
        const clientMock = {
            channels: {
                fetch: async () => ({
                    send: async () => {}
                })
            }
        };

        monitor.start(clientMock);

        // Wait for cycle
        await new Promise(resolve => setTimeout(resolve, 100));

        monitor.stop();

        assert.strictEqual(ticket.state, STATES.GAME_COMPLETE);
        assert.strictEqual(ticket.data.payoutTxId, 'tx-123');
    });

    await t.test('should ignore transactions with wrong amount', async () => {
        const monitor = new PayoutMonitor();
        monitor.scanInterval = 50;

        const ticket = {
            channelId: 'ch-wrong',
            state: STATES.AWAITING_PAYOUT,
            data: { opponentBet: 10, ourBet: 10 }, // Expect 20
            updatedAt: Date.now() - 1000,
            transition: () => {} // Should not be called
        };
        tickets.length = 0;
        tickets.push(ticket);

        recentTransactions = [{
            txId: 'tx-wrong',
            amount: 10, // Not 20
            confirmations: 1,
            timestamp: Date.now()
        }];

        monitor.start({});
        await new Promise(resolve => setTimeout(resolve, 100));
        monitor.stop();

        assert.strictEqual(ticket.state, STATES.AWAITING_PAYOUT);
    });
});
