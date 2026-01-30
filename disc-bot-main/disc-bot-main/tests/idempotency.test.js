/**
 * Persistent Idempotency Tests - Prove D1 requirements are met
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Store module path for cache clearing
const storePath = path.resolve(__dirname, '../src/state/IdempotencyStore.js');
const dataDir = path.resolve(__dirname, '../data');
const idempotencyFile = path.join(dataDir, 'idempotency.json');

// Helper to get fresh store instance
function getFreshStore() {
    // Clear require cache
    delete require.cache[storePath];
    const { IdempotencyStore, PaymentState } = require(storePath);
    return { store: new IdempotencyStore(), PaymentState };
}

// Helper to clean up test data
function cleanup() {
    if (fs.existsSync(idempotencyFile)) {
        fs.unlinkSync(idempotencyFile);
    }
    if (fs.existsSync(idempotencyFile + '.tmp')) {
        fs.unlinkSync(idempotencyFile + '.tmp');
    }
}

describe('Persistent Idempotency Store (D1)', () => {
    beforeEach(() => {
        cleanup();
    });

    afterEach(() => {
        cleanup();
    });

    describe('Persistence across restarts', () => {
        it('should persist payments to disk', () => {
            const { store } = getFreshStore();

            store.recordIntent('test-payment-1', 'addr123', 10, 'ticket-1');

            // Verify file exists
            assert.ok(fs.existsSync(idempotencyFile), 'Idempotency file should exist');

            // Verify content
            const data = JSON.parse(fs.readFileSync(idempotencyFile, 'utf8'));
            assert.ok(data['test-payment-1'], 'Payment should be in file');
        });

        it('should survive process restart (simulate by reloading module)', () => {
            // Create payment with first store instance
            const { store: store1 } = getFreshStore();
            store1.recordIntent('restart-test-1', 'addr123', 10, 'ticket-1');
            store1.recordBroadcast('restart-test-1', 'tx_abc123');
            store1.recordConfirmed('restart-test-1');

            // Create new store instance (simulates restart)
            const { store: store2 } = getFreshStore();

            // Should find the payment
            const payment = store2.getPayment('restart-test-1');
            assert.ok(payment, 'Payment should exist after restart');
            assert.strictEqual(payment.txId, 'tx_abc123');
            assert.strictEqual(payment.state, 'CONFIRMED');

            // Should block duplicate send
            const canSend = store2.canSend('restart-test-1');
            assert.strictEqual(canSend.canSend, false);
            assert.strictEqual(canSend.existingTxId, 'tx_abc123');
        });

        it('should prevent double-send after restart (BROADCAST state)', () => {
            // First instance: record intent and broadcast (crash before confirm)
            const { store: store1 } = getFreshStore();
            store1.recordIntent('crash-test-1', 'addr123', 10, 'ticket-1');
            store1.recordBroadcast('crash-test-1', 'tx_crashed');
            // SIMULATE CRASH - no confirmation recorded

            // Second instance: should detect BROADCAST state
            const { store: store2 } = getFreshStore();
            const canSend = store2.canSend('crash-test-1');

            assert.strictEqual(canSend.canSend, false, 'Should NOT allow re-send');
            assert.strictEqual(canSend.reason, 'Payment already broadcast, awaiting confirmation');
        });
    });

    describe('Duplicate event replay protection', () => {
        it('should block duplicate sends for same payment ID', () => {
            const { store } = getFreshStore();

            // First send
            store.recordIntent('dup-test-1', 'addr123', 10, 'ticket-1');
            store.recordBroadcast('dup-test-1', 'tx_first');
            store.recordConfirmed('dup-test-1');

            // Attempt duplicate
            const canSend = store.canSend('dup-test-1');
            assert.strictEqual(canSend.canSend, false);
            assert.strictEqual(canSend.existingTxId, 'tx_first');
        });
    });

    describe('Concurrent sends protection', () => {
        it('should block second intent for same payment ID', () => {
            const { store } = getFreshStore();

            // First intent
            const first = store.recordIntent('concurrent-1', 'addr123', 10, 'ticket-1');
            assert.strictEqual(first, true);

            // Second intent should fail
            const second = store.recordIntent('concurrent-1', 'addr123', 10, 'ticket-1');
            assert.strictEqual(second, false);
        });
    });

    describe('Daily spend tracking (persistent)', () => {
        it('should track daily spend across multiple payments', () => {
            const { store } = getFreshStore();

            // First payment
            store.recordIntent('daily-1', 'addr123', 10, 'ticket-1');
            store.recordBroadcast('daily-1', 'tx_1');
            store.recordConfirmed('daily-1');

            // Second payment
            store.recordIntent('daily-2', 'addr456', 20, 'ticket-2');
            store.recordBroadcast('daily-2', 'tx_2');
            store.recordConfirmed('daily-2');

            assert.strictEqual(store.getDailySpend(), 30);
        });

        it('should persist daily spend across restarts', () => {
            const { store: store1 } = getFreshStore();
            store1.recordIntent('persist-daily-1', 'addr123', 25, 'ticket-1');
            store1.recordBroadcast('persist-daily-1', 'tx_1');
            store1.recordConfirmed('persist-daily-1');

            // Restart
            const { store: store2 } = getFreshStore();
            assert.strictEqual(store2.getDailySpend(), 25);
        });
    });

    describe('State transitions', () => {
        it('should track full payment lifecycle', () => {
            const { store, PaymentState } = getFreshStore();

            store.recordIntent('lifecycle-1', 'addr123', 10, 'ticket-1');
            let payment = store.getPayment('lifecycle-1');
            assert.strictEqual(payment.state, PaymentState.PENDING);

            store.recordBroadcast('lifecycle-1', 'tx_lifecycle');
            payment = store.getPayment('lifecycle-1');
            assert.strictEqual(payment.state, PaymentState.BROADCAST);

            store.recordConfirmed('lifecycle-1');
            payment = store.getPayment('lifecycle-1');
            assert.strictEqual(payment.state, PaymentState.CONFIRMED);
        });

        it('should allow retry after FAILED state', () => {
            const { store, PaymentState } = getFreshStore();

            store.recordIntent('fail-retry-1', 'addr123', 10, 'ticket-1');
            store.recordFailed('fail-retry-1', 'Network error');

            const canSend = store.canSend('fail-retry-1');
            assert.strictEqual(canSend.canSend, true);
            assert.strictEqual(canSend.reason, 'Retrying failed payment');
        });
    });

    describe('Atomic writes', () => {
        it('should not leave .tmp files after successful save', () => {
            const { store } = getFreshStore();
            store.recordIntent('atomic-1', 'addr123', 10, 'ticket-1');

            assert.ok(!fs.existsSync(idempotencyFile + '.tmp'), 'No .tmp file should remain');
        });
    });
});
