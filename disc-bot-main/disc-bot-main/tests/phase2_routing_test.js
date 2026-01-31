/**
 * PHASE 2 TEST: Message Routing Verification
 * Tests the rewritten routing logic with channel classifier
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 2 TEST: Message Routing Verification');
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

    // Test 1: Channel classifier exists and exports correctly
    await runTest('Channel classifier module exists', () => {
        const classifierPath = path.join(BASE_DIR, 'src', 'utils', 'channelClassifier.js');
        assert(fs.existsSync(classifierPath), 'channelClassifier.js should exist');
    });

    await runTest('Channel classifier exports required functions', () => {
        const classifier = require('../src/utils/channelClassifier');
        assert(typeof classifier.classifyChannel === 'function', 'classifyChannel should be a function');
        assert(typeof classifier.canProcessPayment === 'function', 'canProcessPayment should be a function');
        assert(typeof classifier.canSnipeInChannel === 'function', 'canSnipeInChannel should be a function');
        assert(classifier.ChannelType !== undefined, 'ChannelType should be exported');
    });

    // Test 2: Channel classification works correctly
    await runTest('Classifies public channel correctly', () => {
        const classifier = require('../src/utils/channelClassifier');
        const mockChannel = { id: 'public-123', name: 'lf-players', type: 'GUILD_TEXT' };
        const result = classifier.classifyChannel(mockChannel);
        assert(result.type === classifier.ChannelType.PUBLIC, 'Should be PUBLIC type');
        assert(result.allowSnipe === true, 'Should allow sniping');
        assert(result.allowPayment === false, 'Should NOT allow payment');
    });

    await runTest('Classifies ticket channel correctly', () => {
        const classifier = require('../src/utils/channelClassifier');
        const mockChannel = { id: 'ticket-123', name: 'ticket-abc', type: 'GUILD_TEXT' };
        const result = classifier.classifyChannel(mockChannel);
        assert(result.type === classifier.ChannelType.TICKET, 'Should be TICKET type');
        assert(result.allowSnipe === false, 'Should NOT allow sniping');
        assert(result.allowPayment === true, 'Should allow payment');
    });

    await runTest('Classifies DM correctly', () => {
        const classifier = require('../src/utils/channelClassifier');
        const mockChannel = { id: 'dm-123', name: '', type: 1 };
        const result = classifier.classifyChannel(mockChannel);
        assert(result.type === classifier.ChannelType.DM, 'Should be DM type');
        assert(result.allowSnipe === false, 'Should NOT allow sniping');
        assert(result.allowPayment === false, 'Should NOT allow payment');
    });

    await runTest('Classifies excluded channel correctly', () => {
        const classifier = require('../src/utils/channelClassifier');
        const mockChannel = { id: 'general-123', name: 'general', type: 'GUILD_TEXT' };
        const result = classifier.classifyChannel(mockChannel);
        assert(result.type === classifier.ChannelType.EXCLUDED, 'Should be EXCLUDED type');
        assert(result.allowSnipe === false, 'Should NOT allow sniping');
        assert(result.allowPayment === false, 'Should NOT allow payment');
    });

    // Test 3: MessageCreate uses channel classifier
    await runTest('MessageCreate imports channel classifier', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'events', 'messageCreate.js'), 'utf8');
        assert(code.includes("require('../../utils/channelClassifier')"), 'Should import channelClassifier');
        assert(code.includes('classifyChannel'), 'Should use classifyChannel');
    });

    await runTest('MessageCreate has routing mutex', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'events', 'messageCreate.js'), 'utf8');
        assert(code.includes('routingInProgress'), 'Should have routing mutex');
    });

    await runTest('MessageCreate has routing decision logging', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'events', 'messageCreate.js'), 'utf8');
        assert(code.includes('logRoutingDecision'), 'Should have logRoutingDecision function');
    });

    await runTest('MessageCreate blocks non-bets in public channels', () => {
        const code = fs.readFileSync(path.join(BASE_DIR, 'src', 'bot', 'events', 'messageCreate.js'), 'utf8');
        assert(code.includes('IGNORE_NON_BET_PUBLIC'), 'Should have IGNORE_NON_BET_PUBLIC debug');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 2 TESTS PASSED!');
        console.log('Message routing has been rewritten with explicit channel classification.\n');
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
