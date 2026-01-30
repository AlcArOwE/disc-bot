/**
 * Persistent Idempotency Store
 * Uses JSON file with atomic writes to prevent double-sends across restarts
 * 
 * States:
 * - PENDING: Intent recorded, not yet broadcast
 * - BROADCAST: Transaction broadcast, awaiting confirmation
 * - CONFIRMED: Transaction confirmed
 * - FAILED: Transaction failed
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '../../data');
const IDEMPOTENCY_FILE = path.join(DATA_DIR, 'idempotency.json');

// States for payment lifecycle
const PaymentState = {
    PENDING: 'PENDING',
    BROADCAST: 'BROADCAST',
    CONFIRMED: 'CONFIRMED',
    FAILED: 'FAILED'
};

class IdempotencyStore {
    constructor() {
        this._ensureDataDir();
        this._payments = this._load();
        this._reconcileOnStartup();
    }

    /**
     * Ensure data directory exists
     */
    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            logger.info('Created data directory', { path: DATA_DIR });
        }
    }

    /**
     * Load payments from disk
     */
    _load() {
        try {
            if (fs.existsSync(IDEMPOTENCY_FILE)) {
                const data = fs.readFileSync(IDEMPOTENCY_FILE, 'utf8');
                const payments = JSON.parse(data);
                logger.info('Loaded idempotency store', { paymentCount: Object.keys(payments).length });
                return payments;
            }
        } catch (error) {
            logger.error('Failed to load idempotency store', { error: error.message });
        }
        return {};
    }

    /**
     * Save payments to disk atomically (write to temp file, then rename)
     */
    _save() {
        const tempFile = IDEMPOTENCY_FILE + '.tmp';
        try {
            fs.writeFileSync(tempFile, JSON.stringify(this._payments, null, 2), 'utf8');
            fs.renameSync(tempFile, IDEMPOTENCY_FILE);
        } catch (error) {
            logger.error('Failed to save idempotency store', { error: error.message });
            // Clean up temp file if it exists
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            throw error;
        }
    }

    /**
     * Reconcile pending payments on startup
     * - PENDING payments that never broadcast are safe to retry
     * - BROADCAST payments that never confirmed need manual review
     */
    _reconcileOnStartup() {
        const pendingCount = Object.values(this._payments)
            .filter(p => p.state === PaymentState.PENDING).length;
        const broadcastCount = Object.values(this._payments)
            .filter(p => p.state === PaymentState.BROADCAST).length;

        if (pendingCount > 0 || broadcastCount > 0) {
            logger.warn('⚠️ IDEMPOTENCY RECONCILIATION', {
                pending: pendingCount,
                broadcast: broadcastCount,
                message: 'BROADCAST payments may need manual review'
            });
        }
    }

    /**
     * Generate a unique payment ID
     */
    generatePaymentId(ticketId, toAddress, amount) {
        const data = `${ticketId}:${toAddress}:${amount}`;
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Check if payment already exists and is completed
     * @returns {Object|null} - Existing payment record or null
     */
    getPayment(paymentId) {
        return this._payments[paymentId] || null;
    }

    /**
     * Record intent to send payment (BEFORE broadcast)
     * @returns {boolean} - true if new intent, false if already exists
     */
    recordIntent(paymentId, toAddress, amount, ticketId) {
        if (this._payments[paymentId]) {
            const existing = this._payments[paymentId];
            logger.warn('Payment already exists', {
                paymentId,
                state: existing.state,
                txId: existing.txId
            });
            return false;
        }

        this._payments[paymentId] = {
            paymentId,
            toAddress,
            amount,
            ticketId,
            state: PaymentState.PENDING,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this._save();

        logger.info('Payment intent recorded', { paymentId, state: PaymentState.PENDING });
        return true;
    }

    /**
     * Record that payment was broadcast (AFTER broadcast, BEFORE confirmation)
     */
    recordBroadcast(paymentId, txId) {
        const payment = this._payments[paymentId];
        if (!payment) {
            logger.error('Cannot record broadcast: payment not found', { paymentId });
            return false;
        }

        payment.state = PaymentState.BROADCAST;
        payment.txId = txId;
        payment.updatedAt = new Date().toISOString();
        this._save();

        logger.info('Payment broadcast recorded', { paymentId, txId, state: PaymentState.BROADCAST });
        return true;
    }

    /**
     * Record that payment was confirmed
     */
    recordConfirmed(paymentId) {
        const payment = this._payments[paymentId];
        if (!payment) {
            logger.error('Cannot record confirmed: payment not found', { paymentId });
            return false;
        }

        payment.state = PaymentState.CONFIRMED;
        payment.updatedAt = new Date().toISOString();
        this._save();

        logger.info('Payment confirmed', { paymentId, txId: payment.txId, state: PaymentState.CONFIRMED });
        return true;
    }

    /**
     * Record that payment failed
     */
    recordFailed(paymentId, error) {
        const payment = this._payments[paymentId];
        if (!payment) {
            logger.error('Cannot record failed: payment not found', { paymentId });
            return false;
        }

        payment.state = PaymentState.FAILED;
        payment.error = error;
        payment.updatedAt = new Date().toISOString();
        this._save();

        logger.info('Payment failed recorded', { paymentId, error, state: PaymentState.FAILED });
        return true;
    }

    /**
     * Check if payment is in a state that allows sending
     * @returns {{canSend: boolean, reason: string, existingTxId?: string}}
     */
    canSend(paymentId) {
        const payment = this._payments[paymentId];

        if (!payment) {
            return { canSend: true, reason: 'New payment' };
        }

        switch (payment.state) {
            case PaymentState.PENDING:
                // Never broadcast, safe to retry
                return { canSend: true, reason: 'Retrying pending payment' };

            case PaymentState.BROADCAST:
                // Was broadcast but never confirmed - DANGER
                return {
                    canSend: false,
                    reason: 'Payment already broadcast, awaiting confirmation',
                    existingTxId: payment.txId
                };

            case PaymentState.CONFIRMED:
                // Already completed
                return {
                    canSend: false,
                    reason: 'Payment already confirmed',
                    existingTxId: payment.txId
                };

            case PaymentState.FAILED:
                // Failed, safe to retry
                return { canSend: true, reason: 'Retrying failed payment' };

            default:
                return { canSend: false, reason: 'Unknown state' };
        }
    }

    /**
     * Get daily spending total
     */
    getDailySpend() {
        const today = new Date().toDateString();
        let total = 0;

        for (const payment of Object.values(this._payments)) {
            if (payment.state === PaymentState.CONFIRMED || payment.state === PaymentState.BROADCAST) {
                const paymentDate = new Date(payment.createdAt).toDateString();
                if (paymentDate === today) {
                    total += payment.amount;
                }
            }
        }

        return total;
    }

    /**
     * Get statistics
     */
    getStats() {
        const stats = {
            total: Object.keys(this._payments).length,
            pending: 0,
            broadcast: 0,
            confirmed: 0,
            failed: 0
        };

        for (const payment of Object.values(this._payments)) {
            stats[payment.state.toLowerCase()]++;
        }

        return stats;
    }
}

// Singleton instance
const idempotencyStore = new IdempotencyStore();

module.exports = {
    IdempotencyStore,
    idempotencyStore,
    PaymentState,
    DATA_DIR,
    IDEMPOTENCY_FILE
};
