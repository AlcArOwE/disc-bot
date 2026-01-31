/**
 * PHASE 5 TEST: State Machine Fixes
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 5 TEST: State Machine Fixes');
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

    // Test 1: State utils exists
    await runTest('State utils module exists', () => {
        const utilsPath = path.join(BASE_DIR, 'src', 'utils', 'stateUtils.js');
        assert(fs.existsSync(utilsPath), 'stateUtils.js should exist');
    });

    await runTest('State utils exports required functions', () => {
        const utils = require('../src/utils/stateUtils');
        assert(typeof utils.validateInvariants === 'function');
        assert(typeof utils.detectCorruption === 'function');
        assert(typeof utils.createRollbackPoint === 'function');
        assert(typeof utils.applyRollback === 'function');
        assert(typeof utils.debugDump === 'function');
        assert(typeof utils.findOrphanedTickets === 'function');
    });

    // Test 2: Corruption detection
    await runTest('detectCorruption catches null ticket', () => {
        const utils = require('../src/utils/stateUtils');
        const result = utils.detectCorruption(null);
        assert(result.corrupted === true, 'Should detect null as corrupted');
    });

    await runTest('detectCorruption catches missing channelId', () => {
        const utils = require('../src/utils/stateUtils');
        const result = utils.detectCorruption({ state: 'AWAITING_TICKET', data: {} });
        assert(result.corrupted === true, 'Should detect missing channelId');
        assert(result.issues.includes('Missing channelId'));
    });

    await runTest('detectCorruption accepts valid ticket', () => {
        const utils = require('../src/utils/stateUtils');
        const result = utils.detectCorruption({
            channelId: 'test-123',
            state: 'AWAITING_MIDDLEMAN',
            createdAt: Date.now() - 1000,
            updatedAt: Date.now(),
            data: { opponentBet: 10, ourBet: 10 }
        });
        assert(result.corrupted === false, 'Should accept valid ticket');
    });

    // Test 3: Invariant validation
    await runTest('validateInvariants catches invalid state', () => {
        const utils = require('../src/utils/stateUtils');
        const result = utils.validateInvariants({ state: 'INVALID_STATE' });
        assert(result.valid === false, 'Should catch invalid state');
    });

    await runTest('validateInvariants accepts valid AWAITING_MIDDLEMAN', () => {
        const utils = require('../src/utils/stateUtils');
        const result = utils.validateInvariants({
            channelId: 'test-123',
            state: 'AWAITING_MIDDLEMAN',
            data: {}
        });
        assert(result.valid === true, 'Should accept valid AWAITING_MIDDLEMAN');
    });

    // Test 4: Rollback mechanism
    await runTest('createRollbackPoint creates snapshot', () => {
        const utils = require('../src/utils/stateUtils');
        const mockTicket = {
            channelId: 'test-123',
            state: 'AWAITING_MIDDLEMAN',
            data: { opponentBet: 10 },
            toJSON: function () {
                return { channelId: this.channelId, state: this.state, data: this.data };
            }
        };
        const rollback = utils.createRollbackPoint(mockTicket);
        assert(rollback.timestamp > 0, 'Should have timestamp');
        assert(rollback.snapshot.channelId === 'test-123', 'Should snapshot channelId');
    });

    // Test 5: State metrics
    await runTest('recordTransition tracks metrics', () => {
        const utils = require('../src/utils/stateUtils');
        utils.recordTransition('AWAITING_TICKET', 'AWAITING_MIDDLEMAN', true);
        utils.recordTransition('AWAITING_TICKET', 'AWAITING_MIDDLEMAN', true);
        const metrics = utils.getStateMetrics();
        assert(metrics.transitions['AWAITING_TICKET->AWAITING_MIDDLEMAN'] >= 2);
    });

    // Test 6: Orphan detection
    await runTest('findOrphanedTickets identifies old tickets', () => {
        const utils = require('../src/utils/stateUtils');
        const tickets = new Map();
        tickets.set('old-ticket', {
            state: 'AWAITING_MIDDLEMAN',
            updatedAt: Date.now() - 7200000, // 2 hours ago
            isComplete: () => false
        });
        tickets.set('new-ticket', {
            state: 'AWAITING_MIDDLEMAN',
            updatedAt: Date.now() - 60000, // 1 minute ago
            isComplete: () => false
        });
        const orphaned = utils.findOrphanedTickets(tickets, 3600000);
        assert(orphaned.length === 1, 'Should find 1 orphaned ticket');
        assert(orphaned[0].channelId === 'old-ticket');
    });

    // Test 7: StateMachine has proper structure
    await runTest('StateMachine exports STATES', () => {
        const { STATES } = require('../src/state/StateMachine');
        assert(STATES.AWAITING_TICKET !== undefined);
        assert(STATES.PAYMENT_SENT !== undefined);
        assert(STATES.GAME_COMPLETE !== undefined);
    });

    await runTest('StateMachine has transition validation', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'state', 'StateMachine.js'), 'utf8');
        assert(code.includes('canTransition'), 'Should have canTransition');
        assert(code.includes('TRANSITIONS'), 'Should have TRANSITIONS map');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 5 TESTS PASSED!');
        console.log('State machine improvements verified.\n');
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
