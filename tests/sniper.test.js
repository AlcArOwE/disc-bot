/**
 * Sniper Module Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Mock config before requiring sniper
const mockConfig = {
    betting_limits: { min: 2, max: 50 },
    tax_percentage: 0.15,
    delays: {
        typing_min_ms: 500,
        typing_max_ms: 1500,
        response_base_ms: 800,
        response_per_char_ms: 30
    },
    response_templates: {
        bet_offer: '{calculated} vs your {base} ft5, dice ft5 I win ties, create ticket'
    }
};

// Test regex patterns directly
const { extractBetAmounts, isValidCryptoAddress } = require('../src/utils/regex');

describe('Bet Pattern Detection', () => {
    it('should detect simple XvX format', () => {
        const result = extractBetAmounts('10v10');
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.opponent, 10);
    });

    it('should detect decimal amounts', () => {
        const result = extractBetAmounts('15.50v15.50');
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.opponent, 15.50);
    });

    it('should detect with dollar sign', () => {
        const result = extractBetAmounts('$20v$20');
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.opponent, 20);
    });

    it('should detect with spaces', () => {
        const result = extractBetAmounts('25 v 25');
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.opponent, 25);
    });

    it('should return null for non-bet messages', () => {
        assert.strictEqual(extractBetAmounts('hello world'), null);
        assert.strictEqual(extractBetAmounts('I want to play'), null);
        assert.strictEqual(extractBetAmounts('100'), null);
    });

    it('should handle bet in longer message', () => {
        const result = extractBetAmounts('anyone want to do 15v15?');
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.opponent, 15);
    });
});

describe('Tax Calculation', () => {
    const BigNumber = require('bignumber.js');
    const taxRate = 0.15;

    it('should calculate 15% tax correctly', () => {
        const opponentBet = 10;
        const ourBet = new BigNumber(opponentBet).times(1 + taxRate);
        assert.strictEqual(ourBet.toFixed(2), '11.50');
    });

    it('should handle $15 bet', () => {
        const opponentBet = 15;
        const ourBet = new BigNumber(opponentBet).times(1 + taxRate);
        assert.strictEqual(ourBet.toFixed(2), '17.25');
    });

    it('should handle max $50 bet', () => {
        const opponentBet = 50;
        const ourBet = new BigNumber(opponentBet).times(1 + taxRate);
        assert.strictEqual(ourBet.toFixed(2), '57.50');
    });

    it('should handle decimal bets precisely', () => {
        const opponentBet = 7.77;
        const ourBet = new BigNumber(opponentBet).times(1 + taxRate);
        assert.strictEqual(ourBet.toFixed(2), '8.94');
    });
});

describe('Crypto Address Validation', () => {
    it('should validate Litecoin legacy addresses', () => {
        // L prefix (P2PKH)
        assert.strictEqual(isValidCryptoAddress('LTHPpodwAcSFWzHV4VsGnMHr4sGKPBPcRQ', 'LTC'), true);
        // M prefix (P2SH)
        assert.strictEqual(isValidCryptoAddress('MQ4EE4fzKCMpjVNLFBSwV4QJHqSqaQhH4', 'LTC'), true);
    });

    it('should validate Litecoin Bech32 addresses', () => {
        assert.strictEqual(isValidCryptoAddress('ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9', 'LTC'), true);
    });

    it('should validate Solana addresses', () => {
        assert.strictEqual(isValidCryptoAddress('DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', 'SOL'), true);
    });

    it('should validate Bitcoin addresses', () => {
        // Legacy P2PKH
        assert.strictEqual(isValidCryptoAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'BTC'), true);
        // Legacy P2SH
        assert.strictEqual(isValidCryptoAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'BTC'), true);
    });

    it('should validate Bitcoin Bech32 addresses', () => {
        assert.strictEqual(isValidCryptoAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BTC'), true);
    });

    it('should reject invalid addresses', () => {
        assert.strictEqual(isValidCryptoAddress('invalid', 'LTC'), false);
        assert.strictEqual(isValidCryptoAddress('', 'BTC'), false);
        assert.strictEqual(isValidCryptoAddress('12345', 'SOL'), false);
    });
});
