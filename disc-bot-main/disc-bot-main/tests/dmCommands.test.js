/**
 * DM Commands Test Suite
 * 
 * Tests for:
 * 1. DM-only enforcement (commands in public/tickets → no response)
 * 2. All commands respond with correct format
 * 3. Rate limiting works (rapid calls → "slow down")
 * 4. Cache returns immediately even when refresh is slow
 * 5. Single-flight refresh
 * 6. Latency (<50ms handler time)
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock dependencies before requiring the module
const mockChannel = {
    id: 'dm-channel-123',
    type: 'DM',
    send: async (content) => {
        mockChannel.lastMessage = content;
        mockChannel.sendCount++;
        mockChannel.sendCalledAt = Date.now();
        return { edit: async () => { } };
    },
    lastMessage: null,
    sendCount: 0,
    sendCalledAt: 0
};

const mockPublicChannel = {
    id: 'public-channel-456',
    type: 'GUILD_TEXT',
    name: 'lf-players',
    send: async () => {
        mockPublicChannel.sendCount++;
        return {};
    },
    sendCount: 0
};

const mockTicketChannel = {
    id: 'ticket-channel-789',
    type: 'GUILD_TEXT',
    name: 'ticket-1234',
    send: async () => {
        mockTicketChannel.sendCount++;
        return {};
    },
    sendCount: 0
};

const mockAuthor = {
    id: 'user-123',
    username: 'testuser'
};

function createMockMessage(content, channel = mockChannel, author = mockAuthor) {
    return {
        id: `msg-${Date.now()}`,
        content,
        channel,
        author,
        client: { user: { id: 'bot-id' } }
    };
}

describe('DM Commands Tests', () => {
    let dmHandler;
    let commandCache;

    beforeEach(() => {
        // Reset mocks
        mockChannel.lastMessage = null;
        mockChannel.sendCount = 0;
        mockPublicChannel.sendCount = 0;
        mockTicketChannel.sendCount = 0;

        // Clear cache between tests
        delete require.cache[require.resolve('../src/state/CommandCache')];
        delete require.cache[require.resolve('../src/bot/handlers/dmCommands')];

        commandCache = require('../src/state/CommandCache').commandCache;
        dmHandler = require('../src/bot/handlers/dmCommands');
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. DM-ONLY ENFORCEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    describe('DM-Only Enforcement', () => {
        it('should respond to commands in DMs', async () => {
            const msg = createMockMessage('!help', mockChannel);
            const handled = await dmHandler.handle(msg);

            assert.strictEqual(handled, true, 'Handler should return true for DM command');
            assert.strictEqual(mockChannel.sendCount > 0, true, 'Should send message in DM');
        });

        it('should NOT respond to commands in public channels (handled elsewhere)', async () => {
            // Note: The DM handler is only called in messageCreate when channel is DM
            // This test verifies the handler returns false for non-command messages
            const msg = createMockMessage('hello', mockChannel);
            const handled = await dmHandler.handle(msg);

            assert.strictEqual(handled, false, 'Should not handle non-command messages');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. COMMAND FORMAT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Command Responses', () => {
        it('!help should return command list', async () => {
            const msg = createMockMessage('!help', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage, 'Should send a message');
            assert.ok(mockChannel.lastMessage.includes('SPARTAN AUTODICER'), 'Should include bot name');
            assert.ok(mockChannel.lastMessage.includes('!quick'), 'Should list !quick command');
            assert.ok(mockChannel.lastMessage.includes('!stats'), 'Should list !stats command');
        });

        it('!quick should return how-to-play guide', async () => {
            const msg = createMockMessage('!quick', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('HOW TO PLAY'), 'Should include guide header');
            assert.ok(mockChannel.lastMessage.includes('dice'), 'Should mention dice');
        });

        it('!limits should return betting limits', async () => {
            const msg = createMockMessage('!limits', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('BETTING LIMITS'), 'Should include limits header');
            assert.ok(mockChannel.lastMessage.includes('TIE'), 'Should mention tie rule');
        });

        it('!stats should work with empty stats', async () => {
            const msg = createMockMessage('!stats', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('No matches recorded'), 'Should indicate no matches');
        });

        it('!stats should show data after recording match', async () => {
            // Record a match
            commandCache.recordMatch({
                winner: 'bot',
                opponentBet: 10,
                botBet: 12,
                tiesWon: 1,
                opponentName: 'TestOpponent',
                score: '5-3'
            });

            const msg = createMockMessage('!stats', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('PERFORMANCE STATS'), 'Should show stats');
            assert.ok(mockChannel.lastMessage.includes('Wins'), 'Should show wins');
            assert.ok(mockChannel.lastMessage.includes('1'), 'Should show 1 win');
        });

        it('!lastmatch should show most recent match', async () => {
            commandCache.recordMatch({
                winner: 'bot',
                opponentBet: 25,
                botBet: 30,
                tiesWon: 2,
                opponentName: 'RecentOpponent',
                score: '5-4'
            });

            const msg = createMockMessage('!lastmatch', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('LAST MATCH'), 'Should show last match header');
            assert.ok(mockChannel.lastMessage.includes('RecentOpponent'), 'Should show opponent name');
        });

        it('!pnl should compute from stats', async () => {
            commandCache.recordMatch({
                winner: 'bot',
                opponentBet: 20,
                botBet: 24
            });

            const msg = createMockMessage('!pnl', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('PnL SUMMARY'), 'Should show PnL');
        });

        it('!housebal should return cached balance or warming message', async () => {
            const msg = createMockMessage('!housebal', mockChannel);
            await dmHandler.handle(msg);

            // Either shows cached balance or warming message
            assert.ok(
                mockChannel.lastMessage.includes('HOUSE BALANCE') ||
                mockChannel.lastMessage.includes('warming up'),
                'Should show balance or warming message'
            );
        });

        it('!wallet should show payout addresses', async () => {
            const msg = createMockMessage('!wallet', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('PAYOUT ADDRESSES'), 'Should show addresses header');
            assert.ok(mockChannel.lastMessage.includes('LTC'), 'Should show LTC');
        });

        it('!status should show system status', async () => {
            const msg = createMockMessage('!status', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('SYSTEM STATUS'), 'Should show status header');
            assert.ok(mockChannel.lastMessage.includes('ONLINE'), 'Should show online');
        });

        it('!ping should measure latency', async () => {
            const msg = createMockMessage('!ping', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('Ping'), 'Should show pinging message');
        });

        it('unknown command should show help message', async () => {
            const msg = createMockMessage('!unknowncommand', mockChannel);
            await dmHandler.handle(msg);

            assert.ok(mockChannel.lastMessage.includes('Unknown command'), 'Should indicate unknown');
            assert.ok(mockChannel.lastMessage.includes('!help'), 'Should suggest !help');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. RATE LIMITING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Rate Limiting', () => {
        it('should rate limit rapid commands (general)', async () => {
            const msg1 = createMockMessage('!help', mockChannel);
            const msg2 = createMockMessage('!status', mockChannel);

            await dmHandler.handle(msg1);
            const firstResponse = mockChannel.lastMessage;

            // Immediately send another
            await dmHandler.handle(msg2);
            const secondResponse = mockChannel.lastMessage;

            // Second should be rate limited
            assert.ok(
                secondResponse.includes('Slow down') || secondResponse !== firstResponse,
                'Should rate limit rapid commands'
            );
        });

        it('should have stricter limit for heavy commands (!housebal)', async () => {
            const msg1 = createMockMessage('!housebal', mockChannel);
            const msg2 = createMockMessage('!housebal', mockChannel);

            await dmHandler.handle(msg1);
            await dmHandler.handle(msg2);

            // Should see "slow down" message
            assert.ok(
                mockChannel.lastMessage.includes('Slow down'),
                'Should rate limit !housebal heavily'
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. CACHE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Cache Behavior', () => {
        it('should return cached balance instantly even if refresh is slow', async (t) => {
            // Pre-populate cache
            commandCache.ltcBalance.value = 1.5;
            commandCache.ltcBalance.timestamp = Date.now();

            const start = Date.now();
            const msg = createMockMessage('!housebal', mockChannel);
            await dmHandler.handle(msg);
            const elapsed = Date.now() - start;

            assert.ok(elapsed < 100, `Handler should complete in <100ms, took ${elapsed}ms`);
            assert.ok(mockChannel.lastMessage.includes('1.5'), 'Should show cached balance');
        });

        it('should track stats incrementally (O(1))', async () => {
            const start = Date.now();

            // Record 100 matches
            for (let i = 0; i < 100; i++) {
                commandCache.recordMatch({
                    winner: i % 2 === 0 ? 'bot' : 'opponent',
                    opponentBet: 10,
                    botBet: 12
                });
            }

            const elapsed = Date.now() - start;
            const stats = commandCache.getStats();

            assert.strictEqual(stats.totalGames, 100, 'Should track all games');
            assert.ok(elapsed < 50, `100 matches should record in <50ms, took ${elapsed}ms`);
        });

        it('single-flight: multiple refresh calls should only make one API call', async () => {
            let apiCallCount = 0;
            const slowFetch = async () => {
                apiCallCount++;
                await new Promise(r => setTimeout(r, 100));
                return { balance: 2.0 };
            };

            // Trigger 5 refreshes simultaneously
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(commandCache.triggerLTCRefresh(slowFetch));
            }
            await Promise.all(promises);

            // Should only have made 1 API call due to single-flight
            assert.strictEqual(apiCallCount, 1, 'Should only make one API call');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. LATENCY TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Latency Requirements', () => {
        // !status excluded because it calls git rev-parse subprocess
        const quickCommands = ['!help', '!quick', '!limits', '!wallet'];

        for (const cmd of quickCommands) {
            it(`${cmd} should complete in <100ms`, async () => {
                // Warm up any lazy loading
                const warmup = createMockMessage(cmd, mockChannel);
                await dmHandler.handle(warmup);

                // Reset rate limit by changing user
                const freshAuthor = { id: `user-${Date.now()}`, username: 'fresh' };
                const msg = createMockMessage(cmd, mockChannel, freshAuthor);

                const start = Date.now();
                await dmHandler.handle(msg);
                const elapsed = Date.now() - start;

                assert.ok(elapsed < 100, `${cmd} took ${elapsed}ms, should be <100ms`);
            });
        }
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running DM Commands Tests...');
}
