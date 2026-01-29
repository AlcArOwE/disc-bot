const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const ScoreTracker = require('../src/game/ScoreTracker');
const { extractDiceResult } = require('../src/utils/regex');

describe('Async Game Logic', () => {
    describe('ScoreTracker Async Rolls', () => {
        let tracker;

        beforeEach(() => {
            tracker = new ScoreTracker('test', 5);
        });

        it('should handle bot rolling first', () => {
            // Bot rolls 5
            const result1 = tracker.recordRoll('bot', 5);
            assert.strictEqual(result1, null, 'Should wait for opponent');
            assert.strictEqual(tracker.pendingRolls.bot, 5);

            // Opponent rolls 3
            const result2 = tracker.recordRoll('opponent', 3);
            assert.notStrictEqual(result2, null, 'Should complete round');
            assert.strictEqual(result2.roundWinner, 'bot');
            assert.strictEqual(tracker.scores.bot, 1);

            // Pending should be cleared
            assert.strictEqual(tracker.pendingRolls.bot, null);
            assert.strictEqual(tracker.pendingRolls.opponent, null);
        });

        it('should handle opponent rolling first', () => {
            // Opponent rolls 6
            const result1 = tracker.recordRoll('opponent', 6);
            assert.strictEqual(result1, null, 'Should wait for bot');
            assert.strictEqual(tracker.pendingRolls.opponent, 6);

            // Bot rolls 2
            const result2 = tracker.recordRoll('bot', 2);
            assert.notStrictEqual(result2, null, 'Should complete round');
            assert.strictEqual(result2.roundWinner, 'opponent');
            assert.strictEqual(tracker.scores.opponent, 1);
        });

        it('should handle interleaved turns', () => {
            // Round 1: Bot then Opponent
            tracker.recordRoll('bot', 4);
            tracker.recordRoll('opponent', 2);
            assert.strictEqual(tracker.scores.bot, 1);

            // Round 2: Opponent then Bot
            tracker.recordRoll('opponent', 1);
            tracker.recordRoll('bot', 5);
            assert.strictEqual(tracker.scores.bot, 2);
        });
    });

    describe('Dice Result Extraction with Mentions', () => {
        it('should extract targetId from mentions', () => {
            // Mock Message object
            const mockMessage = {
                content: '@Bot rolled 6',
                mentions: {
                    users: {
                        size: 1,
                        first: () => ({ id: '123456789' })
                    }
                }
            };

            const result = extractDiceResult(mockMessage);
            assert.strictEqual(result.value, 6);
            assert.strictEqual(result.targetId, '123456789');
        });

        it('should return null targetId if no mentions', () => {
            const mockMessage = {
                content: 'rolled 6',
                mentions: {
                    users: {
                        size: 0
                    }
                }
            };

            const result = extractDiceResult(mockMessage);
            assert.strictEqual(result.value, 6);
            assert.strictEqual(result.targetId, null);
        });

        it('should handle string input (backward compatibility)', () => {
            const result = extractDiceResult('rolled 5');
            assert.strictEqual(result.value, 5);
            assert.strictEqual(result.targetId, null);
        });
    });
});
