/**
 * Game Engine Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const DiceEngine = require('../src/game/DiceEngine');
const ScoreTracker = require('../src/game/ScoreTracker');

describe('DiceEngine', () => {
    describe('roll()', () => {
        it('should return values between 1 and 6', () => {
            for (let i = 0; i < 100; i++) {
                const result = DiceEngine.roll();
                assert.ok(result >= 1 && result <= 6, `Roll ${result} out of range`);
            }
        });

        it('should produce varied results', () => {
            const results = new Set();
            for (let i = 0; i < 100; i++) {
                results.add(DiceEngine.roll());
            }
            // Should see at least 4 different values in 100 rolls
            assert.ok(results.size >= 4, 'Not enough variation in rolls');
        });
    });

    describe('compare()', () => {
        it('should return bot as winner when bot rolls higher', () => {
            const result = DiceEngine.compare(6, 3);
            assert.strictEqual(result.winner, 'bot');
        });

        it('should return opponent as winner when opponent rolls higher', () => {
            const result = DiceEngine.compare(2, 5);
            assert.strictEqual(result.winner, 'opponent');
        });

        it('should return bot as winner on tie (when botWinsTies=true)', () => {
            const result = DiceEngine.compare(4, 4, true);
            assert.strictEqual(result.winner, 'bot');
        });

        it('should return tie when botWinsTies=false', () => {
            const result = DiceEngine.compare(4, 4, false);
            assert.strictEqual(result.winner, 'tie');
        });
    });

    describe('getDiceEmoji()', () => {
        it('should return correct emojis', () => {
            assert.strictEqual(DiceEngine.getDiceEmoji(1), '⚀');
            assert.strictEqual(DiceEngine.getDiceEmoji(2), '⚁');
            assert.strictEqual(DiceEngine.getDiceEmoji(3), '⚂');
            assert.strictEqual(DiceEngine.getDiceEmoji(4), '⚃');
            assert.strictEqual(DiceEngine.getDiceEmoji(5), '⚄');
            assert.strictEqual(DiceEngine.getDiceEmoji(6), '⚅');
        });
    });
});

describe('ScoreTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = new ScoreTracker('test-channel', 5);
    });

    describe('recordRound()', () => {
        it('should increment bot score when bot wins', () => {
            const result = tracker.recordRound(6, 3);
            assert.strictEqual(result.botScore, 1);
            assert.strictEqual(result.opponentScore, 0);
            assert.strictEqual(result.roundWinner, 'bot');
        });

        it('should increment opponent score when opponent wins', () => {
            const result = tracker.recordRound(2, 5);
            assert.strictEqual(result.botScore, 0);
            assert.strictEqual(result.opponentScore, 1);
            assert.strictEqual(result.roundWinner, 'opponent');
        });

        it('should increment bot score on tie (bot wins ties)', () => {
            const result = tracker.recordRound(4, 4);
            assert.strictEqual(result.botScore, 1);
            assert.strictEqual(result.roundWinner, 'bot');
        });
    });

    describe('game completion', () => {
        it('should detect game over when bot reaches 5', () => {
            // Bot wins 5 in a row
            for (let i = 0; i < 4; i++) {
                const result = tracker.recordRound(6, 1);
                assert.strictEqual(result.gameOver, false);
            }
            const finalResult = tracker.recordRound(6, 1);
            assert.strictEqual(finalResult.gameOver, true);
            assert.strictEqual(finalResult.gameWinner, 'bot');
        });

        it('should detect game over when opponent reaches 5', () => {
            // Opponent wins 5 in a row
            for (let i = 0; i < 4; i++) {
                tracker.recordRound(1, 6);
            }
            const finalResult = tracker.recordRound(1, 6);
            assert.strictEqual(finalResult.gameOver, true);
            assert.strictEqual(finalResult.gameWinner, 'opponent');
        });
    });

    describe('getScoreString()', () => {
        it('should format score correctly', () => {
            tracker.recordRound(6, 1); // Bot wins
            tracker.recordRound(1, 6); // Opponent wins
            assert.strictEqual(tracker.getScoreString(), 'Bot 1 - 1 Opponent');
        });
    });

    describe('pending roll', () => {
        it('should set and get pending roll', () => {
            tracker.setPendingBotRoll(5);
            assert.strictEqual(tracker.getPendingBotRoll(), 5);
        });

        it('should clear pending roll', () => {
            tracker.setPendingBotRoll(5);
            tracker.clearPendingBotRoll();
            assert.strictEqual(tracker.getPendingBotRoll(), null);
        });
    });

    describe('serialization', () => {
        it('should serialize and deserialize correctly', () => {
            tracker.recordRound(6, 1);
            tracker.recordRound(6, 2);
            tracker.setPendingBotRoll(4);

            const json = tracker.toJSON();
            const restored = ScoreTracker.fromJSON(json);

            assert.strictEqual(restored.scores.bot, 2);
            assert.strictEqual(restored.scores.opponent, 0);
            assert.strictEqual(restored.rounds.length, 2);
            assert.strictEqual(restored.pendingBotRoll, 4);
        });
    });
});
