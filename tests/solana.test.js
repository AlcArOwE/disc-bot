/**
 * Solana Integration Tests
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();

// Mock Solana Web3
const mockConnection = {
    getSignaturesForAddress: mock.fn(),
    getParsedTransaction: mock.fn(),
    getBalance: mock.fn()
};

const mockWeb3 = {
    Connection: class { constructor() { return mockConnection; } },
    Keypair: { fromSecretKey: mock.fn(() => ({ publicKey: 'pubkey' })) },
    clusterApiUrl: mock.fn(),
    PublicKey: mock.fn()
};

const mockBs58 = {
    decode: mock.fn()
};

// Set env
process.env.SOL_PRIVATE_KEY = 'fake_key';

// Load handler
const SolanaHandler = proxyquire('../src/crypto/SolanaHandler', {
    '@solana/web3.js': mockWeb3,
    'bs58': mockBs58,
    '../utils/logger': { logger: { info: console.log, error: console.error } }
});

describe('SolanaHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new SolanaHandler();
    });

    it('should fetch recent transactions correctly', async () => {
        await handler.initialize();

        // Mock signatures
        mockConnection.getSignaturesForAddress.mock.mockImplementation(async () => [
            { signature: 'sig1', err: null }
        ]);

        // Mock transaction details
        mockConnection.getParsedTransaction.mock.mockImplementation(async () => ({
            blockTime: 1234567890,
            transaction: {
                message: {
                    // Simpler mock: accountKeys as objects with pubkey string
                    accountKeys: [{ pubkey: 'pubkey' }]
                }
            },
            meta: {
                preBalances: [1000000000],
                postBalances: [2000000000] // +1 SOL
            }
        }));

        // Ensure handler public key matches
        handler.publicKey = 'pubkey';

        const txs = await handler.getRecentTransactions(1);

        assert.strictEqual(txs.length, 1);
        assert.strictEqual(txs[0].hash, 'sig1');
        assert.strictEqual(txs[0].value, 1.0); // 1 SOL
    });

    it('should ignore outgoing transactions', async () => {
        await handler.initialize();

        mockConnection.getSignaturesForAddress.mock.mockImplementation(async () => [{ signature: 'sig2' }]);
        mockConnection.getParsedTransaction.mock.mockImplementation(async () => ({
            transaction: { message: { accountKeys: [{ pubkey: 'pubkey' }] } },
            meta: {
                preBalances: [2000000000],
                postBalances: [1000000000] // -1 SOL
            }
        }));

        handler.publicKey = 'pubkey';

        const txs = await handler.getRecentTransactions(1);
        assert.strictEqual(txs.length, 0);
    });
});
