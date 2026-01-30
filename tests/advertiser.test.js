/**
 * Auto Advertiser Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

// Mocks
const mockConfig = {
    auto_advertise: {
        enabled: true,
        interval_ms: 50, // fast for testing
        message: 'Test Ad'
    },
    channels: {
        monitored_channels: ['ch-1', 'ch-2']
    }
};

const mockLogger = {
    info: mock.fn(),
    debug: mock.fn(),
    warn: mock.fn(),
    error: mock.fn()
};

// Load module
const { AutoAdvertiser } = proxyquire('../src/bot/AutoAdvertiser', {
    '../../config.json': mockConfig,
    '../utils/logger': { logger: mockLogger }
});

describe('AutoAdvertiser', () => {
    let advertiser;
    let mockClient;
    let mockChannels;

    beforeEach(() => {
        advertiser = new AutoAdvertiser();

        mockChannels = {
            'ch-1': {
                id: 'ch-1',
                send: mock.fn(async () => {}),
                lastMessageId: 'msg-1',
                messages: { fetch: mock.fn(async () => ({ author: { id: 'other-user' } })) }
            },
            'ch-2': {
                id: 'ch-2',
                send: mock.fn(async () => {}),
                lastMessageId: null
            }
        };

        mockClient = {
            user: { id: 'bot-id' },
            channels: {
                fetch: mock.fn(async (id) => mockChannels[id])
            }
        };
    });

    afterEach(() => {
        advertiser.stop();
    });

    it('should start and send advertisements', async () => {
        advertiser.client = mockClient;
        advertiser.isRunning = true;

        // Call directly to bypass 5s safety limit on interval
        await advertiser.advertise();

        // Should have fetched channels
        assert.ok(mockClient.channels.fetch.mock.callCount() >= 2);

        // Should have sent messages
        assert.ok(mockChannels['ch-1'].send.mock.callCount() >= 1);
        assert.ok(mockChannels['ch-2'].send.mock.callCount() >= 1);

        assert.strictEqual(mockChannels['ch-1'].send.mock.calls[0].arguments[0], 'Test Ad');
    });

    it('should skip if last message was ours', async () => {
        // Setup ch-1 to have last message from bot
        mockChannels['ch-1'].messages.fetch.mock.mockImplementation(async () => ({
            author: { id: 'bot-id' }
        }));

        advertiser.client = mockClient;
        advertiser.isRunning = true;

        await advertiser.advertise();

        // Should verify last message
        assert.ok(mockChannels['ch-1'].messages.fetch.mock.callCount() >= 1);

        // Should NOT send to ch-1
        assert.strictEqual(mockChannels['ch-1'].send.mock.callCount(), 0);

        // Should still send to ch-2 (no last msg)
        assert.ok(mockChannels['ch-2'].send.mock.callCount() >= 1);
    });

    it('should not start if disabled in config', () => {
        // Temporarily disable
        mockConfig.auto_advertise.enabled = false;

        advertiser.start(mockClient);
        assert.strictEqual(advertiser.isRunning, false);

        // Restore
        mockConfig.auto_advertise.enabled = true;
    });
});
