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
    delete require.cache[storePath];
    const { IdempotencyStore, PaymentState } = require(storePath);
    return { store: new IdempotencyStore(), PaymentState };
}

function cleanup() {
    if (fs.existsSync(idempotencyFile)) fs.unlinkSync(idempotencyFile);
    if (fs.existsSync(idempotencyFile + '.tmp')) fs.unlinkSync(idempotencyFile + '.tmp');
}

describe('Persistent Idempotency Store (D1)', () => {
    beforeEach(() => { cleanup(); });
    afterEach(() => { cleanup(); });

    describe('Persistence across restarts', () => {
        it('should persist payments to disk', () => {
            const { store } = getFreshStore();
            store.recordIntent('test-payment-1', 'addr123', 10, 'ticket-1');
            assert.ok(fs.existsSync(idempotencyFile), 'Idempotency file should exist');
            const data = JSON.parse(fs.readFileSync(idempotencyFile, 'utf8'));
            assert.ok(data['test-payment-1'], 'Payment should be in file');
        });

        it('should survive process restart', () => {
            const { store: store1 } = getFreshStore();
            store1.recordIntent('restart-test-1', 'addr123', 10, 'ticket-1');
            store1.recordBroadcast('restart-test-1', 'tx_abc123');
            store1.recordConfirmed('restart-test-1');

            const { store: store2 } = getFreshStore();
            const payment = store2.getPayment('restart-test-1');
            assert.ok(payment, 'Payment should exist after restart');
            assert.strictEqual(payment.txId, 'tx_abc123');
            assert.strictEqual(payment.state, 'CONFIRMED');

            const canSend = store2.canSend('restart-test-1');
            assert.strictEqual(canSend.canSend, false);
        });

        it('should prevent double-send after restart (BROADCAST state)', () => {
            const { store: store1 } = getFreshStore();
            store1.recordIntent('crash-test-1', 'addr123', 10, 'ticket-1');
            store1.recordBroadcast('crash-test-1', 'tx_crashed');

            const { store: store2 } = getFreshStore();
            const canSend = store2.canSend('crash-test-1');
            assert.strictEqual(canSend.canSend, false, 'Should NOT allow re-send');
        });
    });

    describe('Daily spend tracking (persistent)', () => {
        it('should track daily spend across multiple payments', () => {
            const { store } = getFreshStore();
            store.recordIntent('daily-1', 'addr123', 10, 'ticket-1');
            store.recordBroadcast('daily-1', 'tx_1');
            store.recordConfirmed('daily-1');
            store.recordIntent('daily-2', 'addr456', 20, 'ticket-2');
            store.recordBroadcast('daily-2', 'tx_2');
            store.recordConfirmed('daily-2');
            assert.strictEqual(store.getDailySpend(), 30);
        });
    });
});
