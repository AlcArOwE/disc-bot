/**
 * Dice Engine - Cryptographically secure dice rolls
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger');

class DiceEngine {
    /**
     * Roll a single die (1-6)
     * Uses crypto.randomInt for cryptographic security
     * @returns {number}
     */
    static roll() {
        const result = crypto.randomInt(1, 7); // 1-6 inclusive
        logger.debug('Dice rolled', { result });
        return result;
    }

    /**
     * Roll multiple dice
     * @param {number} count - Number of dice to roll
     * @returns {number[]}
     */
    static rollMultiple(count) {
        const results = [];
        for (let i = 0; i < count; i++) {
            results.push(this.roll());
        }
        return results;
    }

    /**
     * Compare two dice rolls
     * @param {number} botRoll - Bot's roll
     * @param {number} opponentRoll - Opponent's roll
     * @param {boolean} botWinsTies - If true, bot wins on tie
     * @returns {{ winner: 'bot' | 'opponent' | 'tie', botRoll: number, opponentRoll: number }}
     */
    static compare(botRoll, opponentRoll, botWinsTies = true) {
        let winner;

        if (botRoll > opponentRoll) {
            winner = 'bot';
        } else if (opponentRoll > botRoll) {
            winner = 'opponent';
        } else {
            // Tie - bot wins if configured
            winner = botWinsTies ? 'bot' : 'tie';
        }

        return { winner, botRoll, opponentRoll };
    }

    /**
     * Simulate a complete round
     * @param {boolean} botWinsTies - If true, bot wins on tie
     * @returns {{ winner: 'bot' | 'opponent', botRoll: number, opponentRoll: number }}
     */
    static playRound(botWinsTies = true) {
        const botRoll = this.roll();
        const opponentRoll = this.roll();

        return this.compare(botRoll, opponentRoll, botWinsTies);
    }

    /**
     * Get dice emoji representation
     * @param {number} value - Dice value (1-6)
     * @returns {string}
     */
    static getDiceEmoji(value) {
        const emojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        return emojis[value - 1] || '🎲';
    }

    /**
     * Format dice result for display
     * @param {number} roll - Dice value
     * @returns {string}
     */
    static formatResult(roll) {
        return `${this.getDiceEmoji(roll)} **${roll}**`;
    }
}

module.exports = DiceEngine;
