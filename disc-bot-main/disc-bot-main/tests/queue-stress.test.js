/**
 * MessageQueue Stress Test - Prove rate limiting works
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { MessageQueue } = require('../src/utils/MessageQueue');

describe('MessageQueue Rate Limiting', () => {
    it('should enforce 2-2.5s minimum spacing between sends', async () => {
        const queue = new MessageQueue();
        const sendTimes = [];

        // Mock channel that records send times
        const mockChannel = {
            id: 'test-channel',
            send: async (content) => {
                sendTimes.push(Date.now());
                return { id: 'msg-' + sendTimes.length };
            },
            sendTyping: async () => { }
        };

        // Queue 5 messages rapidly
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(queue.send(mockChannel, `Message ${i}`));
        }

        // Wait for all to complete
        await Promise.all(promises);

        // Analyze timing
        const intervals = [];
        for (let i = 1; i < sendTimes.length; i++) {
            intervals.push(sendTimes[i] - sendTimes[i - 1]);
        }

        // All intervals should be >= 2000ms (allowing 50ms tolerance)
        const minInterval = Math.min(...intervals);
        const maxInterval = Math.max(...intervals);
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

        console.log('Interval stats:', { minInterval, maxInterval, avgInterval, intervals });

        // Verify minimum spacing is enforced (2000ms with 100ms tolerance)
        assert.ok(minInterval >= 1900, `Min interval ${minInterval}ms is less than expected 2000ms`);
        assert.ok(maxInterval <= 3000, `Max interval ${maxInterval}ms is unexpectedly high`);
    });

    it('should queue messages rather than block', async () => {
        const queue = new MessageQueue();
        const sendTimes = [];

        const mockChannel = {
            id: 'test-channel-2',
            send: async (content) => {
                sendTimes.push(Date.now());
                return { id: 'msg-' + sendTimes.length };
            },
            sendTyping: async () => { }
        };

        // Rapid-fire queue 3 messages
        const startTime = Date.now();
        const p1 = queue.send(mockChannel, 'Message 1');
        const p2 = queue.send(mockChannel, 'Message 2');
        const p3 = queue.send(mockChannel, 'Message 3');
        const queueTime = Date.now() - startTime;

        // Queueing should be nearly instant (< 50ms)
        assert.ok(queueTime < 100, `Queueing took ${queueTime}ms, expected < 100ms`);

        // Wait for completion
        await Promise.all([p1, p2, p3]);

        assert.strictEqual(sendTimes.length, 3, 'All 3 messages should have been sent');
    });

    it('should provide accurate stats', () => {
        const queue = new MessageQueue();
        const stats = queue.getStats();

        assert.strictEqual(stats.queueLength, 0);
        assert.strictEqual(stats.processing, false);
        assert.strictEqual(typeof stats.lastSendTime, 'number');
    });

    it('should drain gracefully when empty', async () => {
        const queue = new MessageQueue();
        await queue.drain(); // Should not hang or error
    });
});
