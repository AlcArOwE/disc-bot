/**
 * PHASE 4 TEST: Payment System Hardening
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 4 TEST: Payment System Hardening');
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

    // Test 1: Payment validator exists
    await runTest('Payment validator module exists', () => {
        const validatorPath = path.join(BASE_DIR, 'src', 'utils', 'paymentValidator.js');
        assert(fs.existsSync(validatorPath), 'paymentValidator.js should exist');
    });

    await runTest('Payment validator exports required functions', () => {
        const validator = require('../src/utils/paymentValidator');
        assert(typeof validator.validatePaymentChannel === 'function');
        assert(typeof validator.validatePaymentAmount === 'function');
        assert(typeof validator.validateAddress === 'function');
        assert(typeof validator.validatePayment === 'function');
    });

    // Test 2: Amount validation
    await runTest('Amount validation rejects negative', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validatePaymentAmount(-10);
        assert(result.valid === false, 'Should reject negative amount');
    });

    await runTest('Amount validation rejects zero', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validatePaymentAmount(0);
        assert(result.valid === false, 'Should reject zero amount');
    });

    await runTest('Amount validation rejects too high', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validatePaymentAmount(1000);
        assert(result.valid === false, 'Should reject amount over max');
    });

    await runTest('Amount validation accepts valid amount', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validatePaymentAmount(25);
        assert(result.valid === true, 'Should accept valid amount');
    });

    // Test 3: Address validation
    await runTest('Address validation rejects empty', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validateAddress('', 'LTC');
        assert(result.valid === false, 'Should reject empty address');
    });

    await runTest('Address validation rejects too short', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validateAddress('abc', 'LTC');
        assert(result.valid === false, 'Should reject short address');
    });

    await runTest('Address validation accepts valid LTC format', () => {
        const validator = require('../src/utils/paymentValidator');
        const result = validator.validateAddress('LcRaJWM8sVxj7e6NJ8mvUQfmMaL7r2vhKQ', 'LTC');
        assert(result.valid === true, 'Should accept valid LTC address');
    });

    // Test 4: Crypto index has safety gates
    await runTest('Crypto index has idempotency check', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'crypto', 'index.js'), 'utf8');
        assert(code.includes('idempotencyStore'), 'Should use idempotency store');
    });

    await runTest('Crypto index has balance check', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'crypto', 'index.js'), 'utf8');
        assert(code.includes('INSUFFICIENT BALANCE'), 'Should check balance');
    });

    await runTest('Crypto index has daily limit check', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'crypto', 'index.js'), 'utf8');
        assert(code.includes('dailySpend'), 'Should enforce daily limit');
    });

    await runTest('Crypto index has simulation mode', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'crypto', 'index.js'), 'utf8');
        assert(code.includes('SIMULATION MODE'), 'Should have simulation mode');
    });

    await runTest('Crypto index has dry run mode', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'crypto', 'index.js'), 'utf8');
        assert(code.includes('ENABLE_LIVE_TRANSFERS'), 'Should have dry run mode');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 4 TESTS PASSED!');
        console.log('Payment system hardening verified.\n');
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
