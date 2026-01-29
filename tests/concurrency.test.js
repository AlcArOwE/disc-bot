const test = require('node:test');
const assert = require('node:assert');
const { ChannelLock } = require('../src/utils/ChannelLock');

test('ChannelLock Concurrency', async (t) => {
    const lock = new ChannelLock();

    await t.test('should enforce rate limits on same channel', async () => {
        const channelId = 'ch-1';

        // First acquire should succeed
        assert.strictEqual(lock.acquire(channelId, 100), true);

        // Immediate second acquire should fail
        assert.strictEqual(lock.acquire(channelId, 100), false);

        // Wait for delay
        await new Promise(resolve => setTimeout(resolve, 150));

        // Third acquire should succeed
        assert.strictEqual(lock.acquire(channelId, 100), true);
    });

    await t.test('should allow concurrent locks on different channels', async () => {
        const ch1 = 'ch-A';
        const ch2 = 'ch-B';

        assert.strictEqual(lock.acquire(ch1, 1000), true);
        assert.strictEqual(lock.acquire(ch2, 1000), true); // Should succeed immediately
    });

    await t.test('should release lock manually', async () => {
        const ch = 'ch-manual';
        assert.strictEqual(lock.acquire(ch, 10000), true);
        lock.release(ch);
        assert.strictEqual(lock.acquire(ch, 10000), true); // Should succeed after release
    });
});
