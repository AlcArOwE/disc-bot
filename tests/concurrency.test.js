/**
 * Concurrency Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ChannelLock } = require('../src/utils/ChannelLock');
const { sleep } = require('../src/utils/delay');

describe('ChannelLock', () => {
    it('should lock a channel and force wait', async () => {
        const lock = new ChannelLock();
        lock.cooldownMs = 100; // fast cooldown

        const start = Date.now();
        await lock.acquire('ch-1');

        // Second acquire should wait ~100ms
        await lock.acquire('ch-1');
        const end = Date.now();

        assert.ok((end - start) >= 100, 'Should wait for cooldown');
    });

    it('should allow parallel actions on different channels', async () => {
        const lock = new ChannelLock();
        lock.cooldownMs = 200;

        const start = Date.now();

        // Acquire both "simultaneously"
        await Promise.all([
            lock.acquire('ch-A'),
            lock.acquire('ch-B')
        ]);

        const end = Date.now();
        // Should happen almost instantly, not 200ms
        assert.ok((end - start) < 50, 'Should not block different channels');
    });
});
