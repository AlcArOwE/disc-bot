/**
 * PHASE 6 TEST: Concurrency & Race Conditions
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 6 TEST: Concurrency & Race Conditions');
console.log('═══════════════════════════════════════════════════════════════\n');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
    try {
        await testFn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
        testsFailed++;
    }
}

async function runAllTests() {
    console.log('Loading modules...\n');

    // Test 1: Concurrency module exists
    await runTest('Concurrency module exists', () => {
        const concPath = path.join(BASE_DIR, 'src', 'utils', 'concurrency.js');
        assert(fs.existsSync(concPath), 'concurrency.js should exist');
    });

    await runTest('Concurrency exports required functions', () => {
        const conc = require('../src/utils/concurrency');
        assert(typeof conc.acquireLock === 'function');
        assert(typeof conc.releaseLock === 'function');
        assert(typeof conc.withLock === 'function');
        assert(typeof conc.isLocked === 'function');
        assert(typeof conc.detectDeadlocks === 'function');
        assert(conc.LockType !== undefined);
    });

    // Test 2: Lock acquisition
    await runTest('acquireLock succeeds for new lock', async () => {
        const conc = require('../src/utils/concurrency');
        const result = await conc.acquireLock(conc.LockType.CHANNEL, 'test-channel-1');
        assert(result.acquired === true, 'Should acquire lock');
        assert(result.lockKey === 'CHANNEL:test-channel-1', 'Lock key should be correct');
        conc.releaseLock(result.lockKey);
    });

    await runTest('isLocked returns true for held lock', async () => {
        const conc = require('../src/utils/concurrency');
        const { lockKey } = await conc.acquireLock(conc.LockType.USER, 'test-user-1');
        assert(conc.isLocked(conc.LockType.USER, 'test-user-1') === true);
        conc.releaseLock(lockKey);
        assert(conc.isLocked(conc.LockType.USER, 'test-user-1') === false);
    });

    // Test 3: Lock release
    await runTest('releaseLock succeeds for held lock', async () => {
        const conc = require('../src/utils/concurrency');
        const { lockKey } = await conc.acquireLock(conc.LockType.MESSAGE, 'test-msg-1');
        const released = conc.releaseLock(lockKey);
        assert(released === true, 'Should release lock');
    });

    await runTest('releaseLock returns false for non-existent lock', () => {
        const conc = require('../src/utils/concurrency');
        const released = conc.releaseLock('NON_EXISTENT:fake-id');
        assert(released === false, 'Should return false for non-existent lock');
    });

    // Test 4: withLock helper
    await runTest('withLock executes function and releases', async () => {
        const conc = require('../src/utils/concurrency');
        let executed = false;
        await conc.withLock(conc.LockType.PAYMENT, 'test-payment-1', async () => {
            executed = true;
            // Lock should be held during execution
            assert(conc.isLocked(conc.LockType.PAYMENT, 'test-payment-1') === true);
        });
        assert(executed === true, 'Function should have executed');
        // Lock should be released after
        assert(conc.isLocked(conc.LockType.PAYMENT, 'test-payment-1') === false);
    });

    // Test 5: Lock metrics
    await runTest('getLockMetrics returns stats', () => {
        const conc = require('../src/utils/concurrency');
        const metrics = conc.getLockMetrics();
        assert(typeof metrics.acquired === 'number');
        assert(typeof metrics.released === 'number');
        assert(typeof metrics.currentLocks === 'number');
    });

    // Test 6: Deadlock detection
    await runTest('detectDeadlocks returns array', () => {
        const conc = require('../src/utils/concurrency');
        const deadlocks = conc.detectDeadlocks();
        assert(Array.isArray(deadlocks), 'Should return array');
    });

    // Test 7: Emergency release
    await runTest('emergencyReleaseAll clears all locks', async () => {
        const conc = require('../src/utils/concurrency');
        await conc.acquireLock(conc.LockType.CHANNEL, 'emergency-test-1');
        await conc.acquireLock(conc.LockType.CHANNEL, 'emergency-test-2');
        const released = conc.emergencyReleaseAll();
        assert(released >= 0, 'Should return count');
        const metrics = conc.getLockMetrics();
        assert(metrics.currentLocks === 0, 'All locks should be released');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 6 TESTS PASSED!');
        console.log('Concurrency controls verified.\n');
    } else {
        console.log('⚠️ SOME TESTS FAILED - Review the errors above.\n');
        process.exit(1);
    }
}

runAllTests().catch(error => {
    console.error('❌ TEST RUNNER ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
});
