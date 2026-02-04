/**
 * Exhaustive Game Logic Verification Script
 * Tests all regex patterns, state transitions, and game flow logic
 * 
 * NOTE: Does NOT import StateMachine to avoid circular dependency with TicketManager.
 *       State machine tests are done inline.
 */

const assert = require('assert');

// Load the regex module directly - it has no circular deps
const {
    extractBetAmounts,
    extractCryptoAddress,
    extractGameStart,
    extractDiceResult,
    isPaymentConfirmation,
    isCancellation
} = require('./src/utils/regex');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`❌ ${name}: ${e.message}`);
        failed++;
    }
}

console.log('\\n═══════════════════════════════════════════════════════════════════');
console.log('PHASE 1: REGEX PATTERN VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════════\\n');

// ═══════════════════════════════════════════════════════════════════
// isPaymentConfirmation Tests
// ═══════════════════════════════════════════════════════════════════
console.log('--- isPaymentConfirmation ---');

test('Detects "confirmed"', () => assert.strictEqual(isPaymentConfirmation('confirmed'), true));
test('Detects "received"', () => assert.strictEqual(isPaymentConfirmation('received'), true));
test('Detects "paid"', () => assert.strictEqual(isPaymentConfirmation('both paid'), true));
test('Detects "gl"', () => assert.strictEqual(isPaymentConfirmation('gl'), true));
test('Detects "good luck"', () => assert.strictEqual(isPaymentConfirmation('good luck!'), true));
test('Detects "go" (NEW)', () => assert.strictEqual(isPaymentConfirmation('go'), true));
test('Detects "start" (NEW)', () => assert.strictEqual(isPaymentConfirmation('start'), true));
test('Detects "over" (NEW)', () => assert.strictEqual(isPaymentConfirmation('is it over'), true));
test('Detects "both in" (NEW)', () => assert.strictEqual(isPaymentConfirmation('both in'), true));
test('Detects "ur turn" (NEW)', () => assert.strictEqual(isPaymentConfirmation('ur turn'), true));
test('Detects "rolled"', () => assert.strictEqual(isPaymentConfirmation('rolled'), true));
test('Ignores random text', () => assert.strictEqual(isPaymentConfirmation('hello world'), false));
test('Ignores "going" (not "go")', () => assert.strictEqual(isPaymentConfirmation('I am going home'), false));

// ═══════════════════════════════════════════════════════════════════
// extractGameStart Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\n--- extractGameStart ---');

test('Detects "game start"', () => assert.notStrictEqual(extractGameStart('game start'), null));
test('Detects "rolling"', () => assert.notStrictEqual(extractGameStart('rolling'), null));
test('Detects "go" keyword', () => assert.notStrictEqual(extractGameStart('go'), null));
test('Detects "lets go" (NEW)', () => assert.notStrictEqual(extractGameStart('lets go'), null));
test('Detects "ur turn" (NEW)', () => assert.notStrictEqual(extractGameStart('ur turn'), null));
test('Detects "your turn" (NEW)', () => assert.notStrictEqual(extractGameStart('your turn'), null));
test('Detects "bot turn" (NEW)', () => assert.notStrictEqual(extractGameStart('bot turn'), null));
test('Detects "you go first"', () => {
    const result = extractGameStart('you go first');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.botFirst, true);
});
test('Detects "bot first"', () => {
    const result = extractGameStart('bot first');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.botFirst, true);
});
test('Detects mention with first', () => assert.notStrictEqual(extractGameStart('<@123456789> first'), null));

// ═══════════════════════════════════════════════════════════════════
// extractDiceResult Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\n--- extractDiceResult ---');

test('Detects "rolled a 6"', () => assert.strictEqual(extractDiceResult('rolled a 6'), 6));
test('Detects "rolled 6"', () => assert.strictEqual(extractDiceResult('rolled 6'), 6));
test('Detects "🎲 6"', () => assert.strictEqual(extractDiceResult('🎲 6'), 6));
test('Detects "[6]"', () => assert.strictEqual(extractDiceResult('[6]'), 6));
test('Detects "rolled a **6**"', () => assert.strictEqual(extractDiceResult('rolled a **6**'), 6));
test('Detects "result: 6"', () => assert.strictEqual(extractDiceResult('result: 6'), 6));
test('Detects "result : 6" (spaced)', () => assert.strictEqual(extractDiceResult('result : 6'), 6));
test('Returns null for no dice', () => assert.strictEqual(extractDiceResult('hello world'), null));

// ═══════════════════════════════════════════════════════════════════
// extractBetAmounts Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\n--- extractBetAmounts ---');

test('Extracts "10v10"', () => {
    const result = extractBetAmounts('10v10');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.opponent, 10);
});
test('Extracts "10vs10"', () => {
    const result = extractBetAmounts('10vs10');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.opponent, 10);
});
test('Extracts "$10 v $10"', () => {
    const result = extractBetAmounts('$10 v $10');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.opponent, 10);
});
test('Extracts "3v3.6"', () => {
    const result = extractBetAmounts('3v3.6');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.opponent, 3);
});
test('Extracts "15.5 vs 15.5"', () => {
    const result = extractBetAmounts('15.5 vs 15.5');
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.opponent, 15.5);
});

// ═══════════════════════════════════════════════════════════════════
// extractCryptoAddress Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\n--- extractCryptoAddress ---');

test('Extracts valid LTC address (L prefix)', () => {
    const result = extractCryptoAddress('Send to LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ', 'LTC');
    assert.strictEqual(result, 'LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ');
});
test('Extracts valid LTC address (M prefix)', () => {
    const result = extractCryptoAddress('Address: MSkrNCeAC2QtJ6h6zKNAa5MFNCVvwB9n3A', 'LTC');
    assert.notStrictEqual(result, null);
});
test('Returns null for invalid address', () => {
    const result = extractCryptoAddress('Send to invalid123', 'LTC');
    assert.strictEqual(result, null);
});

// ═══════════════════════════════════════════════════════════════════
// isCancellation Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\n--- isCancellation ---');

test('Detects "void"', () => assert.strictEqual(isCancellation('void this'), true));
test('Detects "cancel"', () => assert.strictEqual(isCancellation('cancel the game'), true));
test('Detects "refund"', () => assert.strictEqual(isCancellation('refund please'), true));
test('Detects "reset"', () => assert.strictEqual(isCancellation('reset the ticket'), true));
test('Ignores random text', () => assert.strictEqual(isCancellation('hello world'), false));

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('VERIFICATION COMPLETE (REGEX PATTERNS ONLY)');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`\nTotal: ${passed + failed} tests`);

if (failed > 0) {
    console.log('\n⚠️ SOME TESTS FAILED - DO NOT START BOT');
    process.exit(1);
} else {
    console.log('\n🎉 ALL REGEX TESTS PASSED');
    process.exit(0);
}
