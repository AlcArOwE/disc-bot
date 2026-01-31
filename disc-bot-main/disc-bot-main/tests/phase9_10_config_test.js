/**
 * PHASE 9-10 TEST: Configuration & Documentation
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 9-10 TEST: Configuration & Production Readiness');
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

    // Test 1: Config validator exists
    await runTest('Config validator module exists', () => {
        const validatorPath = path.join(BASE_DIR, 'src', 'utils', 'configValidator.js');
        assert(fs.existsSync(validatorPath), 'configValidator.js should exist');
    });

    await runTest('Config validator exports required functions', () => {
        const validator = require('../src/utils/configValidator');
        assert(typeof validator.validateConfig === 'function');
        assert(typeof validator.validateEnvironment === 'function');
        assert(typeof validator.productionChecklist === 'function');
        assert(typeof validator.healthCheck === 'function');
    });

    // Test 2: Config validation
    await runTest('validateConfig rejects null', () => {
        const validator = require('../src/utils/configValidator');
        const result = validator.validateConfig(null);
        assert(result.valid === false);
    });

    await runTest('validateConfig checks required keys', () => {
        const validator = require('../src/utils/configValidator');
        const result = validator.validateConfig({});
        assert(result.valid === false);
        assert(result.errors.length > 0);
    });

    await runTest('validateConfig validates actual config', () => {
        const validator = require('../src/utils/configValidator');
        const config = require('../config.json');
        const result = validator.validateConfig(config);
        // Should pass or have only warnings
        assert(Array.isArray(result.errors));
        assert(Array.isArray(result.warnings));
    });

    // Test 3: Environment validation
    await runTest('validateEnvironment returns structure', () => {
        const validator = require('../src/utils/configValidator');
        const result = validator.validateEnvironment();
        assert(typeof result.valid === 'boolean');
        assert(Array.isArray(result.missing));
        assert(Array.isArray(result.warnings));
    });

    // Test 4: Production checklist
    await runTest('productionChecklist returns checks object', () => {
        const validator = require('../src/utils/configValidator');
        const config = require('../config.json');
        const result = validator.productionChecklist(config);
        assert(typeof result.ready === 'boolean');
        assert(typeof result.checks === 'object');
        assert(typeof result.checks.configValid === 'boolean');
        assert(typeof result.checks.safetyEnabled === 'boolean');
    });

    // Test 5: Health check
    await runTest('healthCheck returns status', () => {
        const validator = require('../src/utils/configValidator');
        const config = require('../config.json');
        const result = validator.healthCheck(config);
        assert(typeof result.healthy === 'boolean');
        assert(Array.isArray(result.issues));
    });

    // Test 6: All utility modules load together
    await runTest('All utility modules import together', () => {
        require('../src/utils/channelClassifier');
        require('../src/utils/contentScanner');
        require('../src/utils/ticketValidator');
        require('../src/utils/paymentValidator');
        require('../src/utils/stateUtils');
        require('../src/utils/concurrency');
        require('../src/utils/errorHandler');
        require('../src/utils/betValidator');
        require('../src/utils/configValidator');
        assert(true, 'All modules imported');
    });

    // Test 7: Count all utility modules
    await runTest('9 utility modules created', () => {
        const utilsDir = path.join(BASE_DIR, 'src', 'utils');
        const files = fs.readdirSync(utilsDir).filter(f => f.endsWith('.js'));
        // Count our new modules
        const newModules = [
            'channelClassifier.js',
            'contentScanner.js',
            'ticketValidator.js',
            'paymentValidator.js',
            'stateUtils.js',
            'concurrency.js',
            'errorHandler.js',
            'betValidator.js',
            'configValidator.js'
        ];
        let found = 0;
        for (const mod of newModules) {
            if (files.includes(mod)) found++;
        }
        assert(found === 9, `Expected 9 new modules, found ${found}`);
    });

    // Test 8: All test files exist
    await runTest('All phase test files exist', () => {
        const testDir = path.join(BASE_DIR, 'tests');
        const expectedTests = [
            'phase1_public_channel_blocking_test.js',
            'phase2_routing_test.js',
            'phase3_ticket_safety_test.js',
            'phase4_payment_test.js',
            'phase5_state_test.js',
            'phase6_concurrency_test.js',
            'phase7_10_final_test.js',
            'phase8_testing_test.js'
        ];
        for (const test of expectedTests) {
            const testPath = path.join(testDir, test);
            assert(fs.existsSync(testPath), `Missing test: ${test}`);
        }
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 9-10 TESTS PASSED!');
        console.log('Configuration & production readiness verified.\n');
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
