/**
 * Test Suite for DM Commands & Opt-Out Manager
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dmCommandHandler = require('../src/bot/handlers/dmCommands');
const optOutManager = require('../src/state/OptOutManager');

// Mock objects
const mockChannel = {
    send: async (content) => {
        console.log('[MOCK SEND]:', content);
        return { edit: async () => { } };
    }
};

const mockMessage = {
    content: '',
    author: { id: 'test-user-123', username: 'TestUser' },
    channel: mockChannel,
    reply: async (c) => console.log('[MOCK REPLY]:', c)
};

async function runTests() {
    console.log('🧪 Starting DM Command Tests...\n');

    // 1. Opt-Out Manager Tests
    console.log('Test 1: Opt-Out Manager Persistence');
    const testId = 'test-opt-user-999';

    // Clear previous state
    if (optOutManager.isOptedOut(testId)) optOutManager.optIn(testId);

    // Initial state
    assert.strictEqual(optOutManager.isOptedOut(testId), false, 'Should start opted in');

    // Opt Out
    optOutManager.optOut(testId);
    assert.strictEqual(optOutManager.isOptedOut(testId), true, 'Should be opted out');

    // Persistence Check (reload)
    const optOutManager2 = require('../src/state/OptOutManager');
    // Force reload by clearing cache (simulation)
    // In real node, module is cached, but we verify the file write:
    const savedData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/opt_outs.json')));
    assert.ok(savedData.includes(testId), 'Should save to disk');

    // Opt In
    optOutManager.optIn(testId);
    assert.strictEqual(optOutManager.isOptedOut(testId), false, 'Should be opted in');
    console.log('✅ Opt-Out Manager passed\n');

    // 2. Command Parsing Tests
    console.log('Test 2: DM Command Routing');

    // !help
    mockMessage.content = '!help';
    await dmCommandHandler.handle(mockMessage);

    // !status
    mockMessage.content = '!status';
    await dmCommandHandler.handle(mockMessage);

    // !opt out
    mockMessage.content = '!opt out';
    await dmCommandHandler.handle(mockMessage);
    assert.strictEqual(optOutManager.isOptedOut('test-user-123'), true, 'Command should trigger opt-out');

    // !opt in
    mockMessage.content = '!opt in';
    await dmCommandHandler.handle(mockMessage);
    assert.strictEqual(optOutManager.isOptedOut('test-user-123'), false, 'Command should trigger opt-in');

    console.log('✅ DM Command Routing passed\n');

    console.log('🎉 ALL TESTS PASSED');
    process.exit(0);
}

runTests().catch(e => {
    console.error('❌ TESTS FAILED:', e);
    process.exit(1);
});
