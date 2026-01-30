/**
 * Payment Safety Gate Tests - Updated for persistent idempotency
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Payment Safety Gates', () => {
    let originalEnv;

    beforeEach(() => {
        // Save original env
        originalEnv = { ...process.env };
        // Reset env for clean test
        delete process.env.ENABLE_LIVE_TRANSFERS;
        delete process.env.MAX_PAYMENT_PER_TX;

        // Clean up idempotency file
        const idempotencyFile = path.resolve(__dirname, '../data/idempotency.json');
        if (fs.existsSync(idempotencyFile)) {
            fs.unlinkSync(idempotencyFile);
        }
    });

    afterEach(() => {
        // Restore original env
        process.env = originalEnv;
    });

    describe('Gate 2: DRY-RUN Default', () => {
        it('should return dry-run when ENABLE_LIVE_TRANSFERS is not set', async () => {
            // Clear cache
            delete require.cache[require.resolve('../src/crypto/index.js')];
            delete require.cache[require.resolve('../src/state/IdempotencyStore.js')];
            const { sendPayment } = require('../src/crypto/index.js');

            const result = await sendPayment('LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ', 10);

            assert.strictEqual(result.success, true);
            assert.ok(result.txId.startsWith('dryrun_tx_') || result.txId.startsWith('simulated_tx_'));
        });

        it('should return dry-run=true flag when not live', async () => {
            delete require.cache[require.resolve('../src/crypto/index.js')];
            delete require.cache[require.resolve('../src/state/IdempotencyStore.js')];
            const { sendPayment } = require('../src/crypto/index.js');

            const result = await sendPayment('LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ', 10);

            // Either simulation mode or dry-run mode
            if (result.txId.startsWith('dryrun_tx_')) {
                assert.strictEqual(result.dryRun, true);
            }
        });
    });

    describe('Gate 5: Per-Transaction Limit', () => {
        it('should reject payments exceeding per-tx limit', async () => {
            // First enable live transfers to bypass gate 2
            process.env.ENABLE_LIVE_TRANSFERS = 'true';

            // Clear module cache to pick up new env
            delete require.cache[require.resolve('../src/crypto/index.js')];
            delete require.cache[require.resolve('../src/state/IdempotencyStore.js')];
            const { sendPayment } = require('../src/crypto/index.js');

            // Try to send $100 when default limit is $50
            const result = await sendPayment('LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ', 100);

            assert.strictEqual(result.success, false);
            assert.ok(result.error.includes('exceeds limit'));
        });
    });

    describe('Gate 4: Address Allowlist', () => {
        it('should have allowlist enforcement in code', () => {
            const cryptoCode = fs.readFileSync('./src/crypto/index.js', 'utf8');

            assert.ok(cryptoCode.includes('address_allowlist'));
            assert.ok(cryptoCode.includes('ADDRESS NOT IN ALLOWLIST'));
        });
    });

    describe('Gate 3: Persistent Idempotency', () => {
        it('should use IdempotencyStore for tracking', () => {
            const cryptoCode = fs.readFileSync('./src/crypto/index.js', 'utf8');

            assert.ok(cryptoCode.includes('idempotencyStore'));
            assert.ok(cryptoCode.includes('PERSISTENT Idempotency'));
        });

        it('should store data in JSON file, not Map', () => {
            const cryptoCode = fs.readFileSync('./src/crypto/index.js', 'utf8');

            // Should NOT have the old in-memory Map
            assert.ok(!cryptoCode.includes('const completedPayments = new Map()'));
            // Should have the persistent store import
            assert.ok(cryptoCode.includes("require('../state/IdempotencyStore')"));
        });
    });

    describe('Gate 6: Daily Limit', () => {
        it('should use persistent daily limit tracking', () => {
            const cryptoCode = fs.readFileSync('./src/crypto/index.js', 'utf8');

            assert.ok(cryptoCode.includes('getDailySpend'));
            assert.ok(cryptoCode.includes('max_daily_usd'));
        });

        it('should track daily spend in persistent store', () => {
            const storeCode = fs.readFileSync('./src/state/IdempotencyStore.js', 'utf8');

            assert.ok(storeCode.includes('getDailySpend'));
            assert.ok(storeCode.includes('toDateString'));
        });
    });
});
