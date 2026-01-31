/**
 * Concurrency Utilities
 * Phase 6: Lock management, mutex, race condition prevention
 */

const { logger } = require('./logger');

// Lock types
const LockType = {
    MESSAGE: 'MESSAGE',    // Per-message lock
    CHANNEL: 'CHANNEL',    // Per-channel lock
    USER: 'USER',          // Per-user lock
    PAYMENT: 'PAYMENT',    // Payment-specific lock
    GLOBAL: 'GLOBAL'       // Global lock
};

// Lock storage
const locks = new Map();
const lockWaiters = new Map(); // Track who's waiting for locks
const lockMetrics = {
    acquired: 0,
    released: 0,
    timeouts: 0,
    contentions: 0
};

// Default timeout for lock acquisition (ms)
const DEFAULT_LOCK_TIMEOUT = 30000;
const MAX_LOCK_HOLD_TIME = 60000;

/**
 * Create a lock key
 * @param {string} type - Lock type
 * @param {string} id - Resource ID
 * @returns {string}
 */
function createLockKey(type, id) {
    return `${type}:${id}`;
}

/**
 * Acquire a lock
 * @param {string} type - Lock type
 * @param {string} id - Resource ID
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<{acquired: boolean, lockKey: string}>}
 */
async function acquireLock(type, id, timeout = DEFAULT_LOCK_TIMEOUT) {
    const lockKey = createLockKey(type, id);
    const now = Date.now();

    // Check if lock exists
    const existingLock = locks.get(lockKey);

    if (existingLock) {
        // Check for stale lock (held too long)
        if (now - existingLock.acquiredAt > MAX_LOCK_HOLD_TIME) {
            logger.warn('🔓 Releasing stale lock', {
                lockKey,
                heldFor: now - existingLock.acquiredAt
            });
            locks.delete(lockKey);
        } else {
            // Lock is held, track contention
            lockMetrics.contentions++;

            // Wait for lock with timeout
            const waitStart = Date.now();
            while (locks.has(lockKey)) {
                if (Date.now() - waitStart > timeout) {
                    lockMetrics.timeouts++;
                    logger.warn('⏱️ Lock acquisition timeout', { lockKey, timeout });
                    return { acquired: false, lockKey, reason: 'timeout' };
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }

    // Acquire lock
    locks.set(lockKey, {
        type,
        id,
        acquiredAt: Date.now(),
        holder: new Error().stack // For debugging
    });

    lockMetrics.acquired++;

    logger.debug('🔒 Lock acquired', { lockKey });

    return { acquired: true, lockKey };
}

/**
 * Release a lock
 * @param {string} lockKey - Lock key to release
 * @returns {boolean} Success
 */
function releaseLock(lockKey) {
    if (!locks.has(lockKey)) {
        logger.warn('🔓 Attempted to release non-existent lock', { lockKey });
        return false;
    }

    locks.delete(lockKey);
    lockMetrics.released++;

    logger.debug('🔓 Lock released', { lockKey });

    return true;
}

/**
 * Execute a function with a lock
 * @param {string} type - Lock type
 * @param {string} id - Resource ID
 * @param {Function} fn - Function to execute
 * @param {number} timeout - Lock timeout
 * @returns {Promise<any>} Result of function
 */
async function withLock(type, id, fn, timeout = DEFAULT_LOCK_TIMEOUT) {
    const { acquired, lockKey, reason } = await acquireLock(type, id, timeout);

    if (!acquired) {
        throw new Error(`Failed to acquire lock ${lockKey}: ${reason}`);
    }

    try {
        return await fn();
    } finally {
        releaseLock(lockKey);
    }
}

/**
 * Check if a resource is locked
 * @param {string} type - Lock type
 * @param {string} id - Resource ID
 * @returns {boolean}
 */
function isLocked(type, id) {
    const lockKey = createLockKey(type, id);
    return locks.has(lockKey);
}

/**
 * Get lock metrics
 * @returns {Object}
 */
function getLockMetrics() {
    return {
        ...lockMetrics,
        currentLocks: locks.size,
        activeKeys: Array.from(locks.keys())
    };
}

/**
 * Detect potential deadlocks (simple cycle detection)
 * @returns {Array} Potential deadlock chains
 */
function detectDeadlocks() {
    const potentialDeadlocks = [];

    // Check for locks held too long
    const now = Date.now();
    for (const [key, lock] of locks) {
        const holdTime = now - lock.acquiredAt;
        if (holdTime > MAX_LOCK_HOLD_TIME / 2) {
            potentialDeadlocks.push({
                lockKey: key,
                holdTimeMs: holdTime,
                type: lock.type
            });
        }
    }

    return potentialDeadlocks;
}

/**
 * Force release all locks (emergency)
 * @returns {number} Number of locks released
 */
function emergencyReleaseAll() {
    const count = locks.size;
    locks.clear();
    logger.warn('🚨 EMERGENCY: All locks released', { count });
    return count;
}

/**
 * Cleanup stale locks
 * @returns {number} Number of locks cleaned up
 */
function cleanupStaleLocks() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, lock] of locks) {
        if (now - lock.acquiredAt > MAX_LOCK_HOLD_TIME) {
            locks.delete(key);
            cleaned++;
            logger.info('🧹 Cleaned up stale lock', { lockKey: key });
        }
    }

    return cleaned;
}

// Periodic cleanup (every 5 minutes)
setInterval(() => {
    const cleaned = cleanupStaleLocks();
    if (cleaned > 0) {
        logger.info('Lock cleanup completed', { cleaned });
    }
}, 5 * 60 * 1000);

module.exports = {
    LockType,
    acquireLock,
    releaseLock,
    withLock,
    isLocked,
    getLockMetrics,
    detectDeadlocks,
    emergencyReleaseAll,
    cleanupStaleLocks,
    createLockKey,
    DEFAULT_LOCK_TIMEOUT,
    MAX_LOCK_HOLD_TIME
};
