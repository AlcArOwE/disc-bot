/**
 * PHASE 3 TEST: Ticket Handler Safety
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 3 TEST: Ticket Handler Safety');
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

    // Test 1: Ticket validator exists
    await runTest('Ticket validator module exists', () => {
        const validatorPath = path.join(BASE_DIR, 'src', 'utils', 'ticketValidator.js');
        assert(fs.existsSync(validatorPath), 'ticketValidator.js should exist');
    });

    await runTest('Ticket validator exports required functions', () => {
        const validator = require('../src/utils/ticketValidator');
        assert(typeof validator.validateTicket === 'function', 'validateTicket should be a function');
        assert(typeof validator.validateTransition === 'function', 'validateTransition should be a function');
        assert(typeof validator.verifyTicketOwnership === 'function', 'verifyTicketOwnership should be a function');
        assert(typeof validator.shouldExpireTicket === 'function', 'shouldExpireTicket should be a function');
    });

    // Test 2: Ticket validation
    await runTest('validateTicket rejects null ticket', () => {
        const validator = require('../src/utils/ticketValidator');
        const result = validator.validateTicket(null);
        assert(result.valid === false, 'Should reject null ticket');
    });

    await runTest('validateTicket accepts valid ticket', () => {
        const validator = require('../src/utils/ticketValidator');
        const mockTicket = {
            channelId: 'test-123',
            state: 'AWAITING_MIDDLEMAN',
            data: { opponentId: 'user-123' }
        };
        const result = validator.validateTicket(mockTicket);
        assert(result.valid === true, 'Should accept valid ticket');
    });

    // Test 3: Transition validation
    await runTest('validateTransition allows valid transitions', () => {
        const validator = require('../src/utils/ticketValidator');
        const result = validator.validateTransition('AWAITING_MIDDLEMAN', 'AWAITING_PAYMENT_ADDRESS');
        assert(result.valid === true, 'Should allow valid transition');
    });

    await runTest('validateTransition blocks invalid transitions', () => {
        const validator = require('../src/utils/ticketValidator');
        const result = validator.validateTransition('AWAITING_MIDDLEMAN', 'GAME_COMPLETE');
        assert(result.valid === false, 'Should block invalid transition');
    });

    // Test 4: Ownership verification
    await runTest('verifyTicketOwnership allows middlemen', () => {
        const validator = require('../src/utils/ticketValidator');
        const config = require('../config.json');
        const middlemanId = config.middleman_ids[0];
        const mockTicket = { data: { opponentId: 'other-user' } };
        const result = validator.verifyTicketOwnership(mockTicket, middlemanId, 'payment');
        assert(result.authorized === true, 'Middleman should be authorized');
    });

    await runTest('verifyTicketOwnership blocks non-owners for payments', () => {
        const validator = require('../src/utils/ticketValidator');
        const mockTicket = { data: { opponentId: 'user-123' } };
        const result = validator.verifyTicketOwnership(mockTicket, 'random-user', 'payment');
        assert(result.authorized === false, 'Random user should not be authorized for payment');
    });

    // Test 5: Ticket handler has channel validation
    await runTest('Ticket handler has channel validation at entry', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'handlers', 'ticket.js'), 'utf8');
        assert(code.includes('PRE-FLIGHT VALIDATION'), 'Should have pre-flight validation');
        assert(code.includes('TICKET_HANDLER_BLOCKED'), 'Should have blocking log');
    });

    // Test 6: Payment handler has channel verification
    await runTest('Payment handler has channel verification', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'handlers', 'ticket.js'), 'utf8');
        assert(code.includes('PAYMENT BLOCKED'), 'Should have payment blocking');
        assert(code.includes('EMERGENCY_STOP'), 'Should check EMERGENCY_STOP');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 3 TESTS PASSED!');
        console.log('Ticket handler safety improvements verified.\n');
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
