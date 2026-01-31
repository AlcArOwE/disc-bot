/**
 * PHASE 8 TEST: Testing Infrastructure
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 8 TEST: Testing Infrastructure');
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

    // Test 1: Bet validator exists
    await runTest('Bet validator module exists', () => {
        const validatorPath = path.join(BASE_DIR, 'src', 'utils', 'betValidator.js');
        assert(fs.existsSync(validatorPath), 'betValidator.js should exist');
    });

    await runTest('Bet validator exports required functions', () => {
        const validator = require('../src/utils/betValidator');
        assert(typeof validator.validateBetAmount === 'function');
        assert(typeof validator.calculateTaxedBet === 'function');
        assert(typeof validator.checkBetCooldown === 'function');
        assert(typeof validator.validateBet === 'function');
    });

    // Test 2: Mock Discord exists
    await runTest('Mock Discord module exists', () => {
        const mockPath = path.join(BASE_DIR, 'tests', 'mockDiscord.js');
        assert(fs.existsSync(mockPath), 'mockDiscord.js should exist');
    });

    await runTest('Mock Discord exports required classes', () => {
        const mock = require('./mockDiscord');
        assert(mock.MockDiscordClient !== undefined);
        assert(mock.MockChannel !== undefined);
        assert(mock.MockMessage !== undefined);
        assert(mock.MockUser !== undefined);
        assert(mock.createTestEnvironment !== undefined);
    });

    // Test 3: Bet amount validation
    await runTest('validateBetAmount rejects negative', () => {
        const validator = require('../src/utils/betValidator');
        const result = validator.validateBetAmount(-10);
        assert(result.valid === false);
    });

    await runTest('validateBetAmount rejects too high', () => {
        const validator = require('../src/utils/betValidator');
        const result = validator.validateBetAmount(1000);
        assert(result.valid === false);
    });

    await runTest('validateBetAmount accepts valid amount', () => {
        const validator = require('../src/utils/betValidator');
        const result = validator.validateBetAmount(25);
        assert(result.valid === true);
    });

    // Test 4: Tax calculation
    await runTest('calculateTaxedBet calculates correctly', () => {
        const validator = require('../src/utils/betValidator');
        const result = validator.calculateTaxedBet(10, 0.10); // 10% tax
        assert(result.valid === true);
        assert(result.ourBet === 11.00, `Expected 11.00 but got ${result.ourBet}`);
        assert(result.taxAmount === 1.00, `Expected 1.00 but got ${result.taxAmount}`);
    });

    // Test 5: Mock Discord works
    await runTest('MockDiscordClient creates channels', () => {
        const { MockDiscordClient } = require('./mockDiscord');
        const client = new MockDiscordClient();
        const channel = client.createChannel('test-id', 'test-channel');
        assert(channel.id === 'test-id');
        assert(channel.name === 'test-channel');
    });

    await runTest('createTestEnvironment provides full setup', () => {
        const { createTestEnvironment } = require('./mockDiscord');
        const env = createTestEnvironment();
        assert(env.client !== undefined);
        assert(env.publicChannel !== undefined);
        assert(env.ticketChannel !== undefined);
        assert(env.testUser !== undefined);
        assert(typeof env.createBetMessage === 'function');
    });

    await runTest('Mock messages can be created', () => {
        const { createTestEnvironment } = require('./mockDiscord');
        const env = createTestEnvironment();
        const msg = env.createBetMessage(25);
        assert(msg.content === '$25 on me');
        assert(msg.author.id === 'user-123');
    });

    // Test 6: Sniper handler exists and has safety
    await runTest('Sniper handler has safety gates', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'handlers', 'sniper.js'), 'utf8');
        assert(code.includes('MAX_BET_SAFETY_USD'), 'Should have max bet safety');
        assert(code.includes('processingUsers'), 'Should have processing lock');
    });

    // Test 7: Integration - validate bet with full environment
    await runTest('Full bet validation works', () => {
        const validator = require('../src/utils/betValidator');
        const result = validator.validateBet({
            userId: 'test-user-integration',
            amount: 15
        });
        assert(result.valid === true, 'Should validate successfully');
        assert(result.betData !== null, 'Should have bet data');
        assert(result.betData.ourBet > 15, 'Our bet should include tax');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 8 TESTS PASSED!');
        console.log('Testing infrastructure verified.\n');
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
