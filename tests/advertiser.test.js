const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

test('AutoAdvertiser', async (t) => {
    // Patch Math.random to eliminate variance
    const originalRandom = Math.random;
    Math.random = () => 0.5; // Variance = 0

    // Mocks
    const configMock = {
        auto_advertise: {
            enabled: true,
            interval_ms: 50, // Very short interval
            messages: ['Test Msg 1', 'Test Msg 2']
        },
        channels: {
            monitored_channels: ['ch-1', 'ch-2']
        }
    };

    const ticketManagerMock = {
        getActiveTickets: () => []
    };

    const channelLockMock = {
        acquire: () => true
    };

    const delayMock = {
        humanDelay: async () => {}
    };

    // Load module with mocks
    const { AutoAdvertiser } = proxyquire('../src/bot/AutoAdvertiser', {
        '../../config.json': configMock,
        '../state/TicketManager': { ticketManager: ticketManagerMock },
        '../utils/ChannelLock': { channelLock: channelLockMock },
        '../utils/delay': delayMock
    });

    await t.test('should send messages to monitored channels', async () => {
        const advertiser = new AutoAdvertiser();
        const sentMessages = [];

        const clientMock = {
            channels: {
                fetch: async (id) => ({
                    id,
                    send: async (msg) => sentMessages.push({ channelId: id, content: msg })
                })
            }
        };

        advertiser.start(clientMock);

        // Wait long enough for at least one cycle (50ms interval)
        await new Promise(resolve => setTimeout(resolve, 300));

        advertiser.stop();

        assert.ok(sentMessages.length > 0, 'Should have sent messages');
        assert.ok(configMock.channels.monitored_channels.includes(sentMessages[0].channelId));
        assert.ok(configMock.auto_advertise.messages.includes(sentMessages[0].content));
    });

    await t.test('should skip if busy (Smart Mode)', async () => {
        ticketManagerMock.getActiveTickets = () => [1, 2, 3];

        const advertiser = new AutoAdvertiser();
        const sentMessages = [];

        const clientMock = {
            channels: {
                fetch: async (id) => ({
                    id,
                    send: async (msg) => sentMessages.push({ channelId: id, content: msg })
                })
            }
        };

        advertiser.start(clientMock);

        await new Promise(resolve => setTimeout(resolve, 300));

        advertiser.stop();

        assert.strictEqual(sentMessages.length, 0, 'Should not send messages when busy');

        ticketManagerMock.getActiveTickets = () => [];
    });

    // Restore random
    Math.random = originalRandom;
});
