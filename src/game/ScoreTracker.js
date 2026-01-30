/**
 * Score Tracker - First-to-5 game scoring
 */

const { logger, logGame } = require('../utils/logger');
const config = require('../../config.json');

class ScoreTracker {
    /**
     * @param {string} ticketId - Ticket/channel ID for logging
     * @param {number} winsNeeded - Wins needed to complete game (default 5)
     */
    constructor(ticketId, winsNeeded = config.game_settings.wins_to_complete) {
        this.ticketId = ticketId;
        this.winsNeeded = winsNeeded;
        this.botWinsTies = config.game_settings.bot_wins_ties;

        this.scores = {
            bot: 0,
            opponent: 0
        };

        this.rounds = [];
        this.pendingBotRoll = null; // Stores bot roll if waiting for opponent
        this.startedAt = Date.now();
        this.completedAt = null;
        this.winner = null;
    }

    /**
     * Record a round result
     * @param {number} botRoll - Bot's dice roll
     * @param {number} opponentRoll - Opponent's dice roll
     * @returns {{ roundWinner: string, botScore: number, opponentScore: number, gameOver: boolean, gameWinner: string | null }}
     */
    recordRound(botRoll, opponentRoll) {
        let roundWinner;

        if (botRoll > opponentRoll) {
            roundWinner = 'bot';
            this.scores.bot++;
        } else if (opponentRoll > botRoll) {
            roundWinner = 'opponent';
            this.scores.opponent++;
        } else {
            // Tie handling
            if (this.botWinsTies) {
                roundWinner = 'bot';
                this.scores.bot++;
            } else {
                roundWinner = 'tie';
                // No score change on tie
            }
        }

        const round = {
            number: this.rounds.length + 1,
            botRoll,
            opponentRoll,
            winner: roundWinner,
            scoresAfter: { ...this.scores },
            timestamp: Date.now()
        };

        this.rounds.push(round);

        // Check for game completion
        const gameOver = this.isGameComplete();
        let gameWinner = null;

        if (gameOver) {
            gameWinner = this.scores.bot >= this.winsNeeded ? 'bot' : 'opponent';
            this.winner = gameWinner;
            this.completedAt = Date.now();

            logGame('GAME_COMPLETE', {
                ticketId: this.ticketId,
                winner: gameWinner,
                finalScore: this.scores,
                rounds: this.rounds.length,
                duration: this.completedAt - this.startedAt
            });
        }

        logger.info('Round recorded', {
            ticketId: this.ticketId,
            round: round.number,
            botRoll,
            opponentRoll,
            roundWinner,
            scores: this.scores,
            gameOver
        });

        return {
            roundWinner,
            botScore: this.scores.bot,
            opponentScore: this.scores.opponent,
            gameOver,
            gameWinner
        };
    }

    /**
     * Check if game is complete
     * @returns {boolean}
     */
    isGameComplete() {
        return this.scores.bot >= this.winsNeeded || this.scores.opponent >= this.winsNeeded;
    }

    /**
     * Get current score string
     * @returns {string}
     */
    getScoreString() {
        return `Bot ${this.scores.bot} - ${this.scores.opponent} Opponent`;
    }

    /**
     * Get formatted score for Discord
     * @returns {string}
     */
    getFormattedScore() {
        return `**${this.scores.bot}** - **${this.scores.opponent}**`;
    }

    /**
     * Check if bot is winning
     * @returns {boolean}
     */
    isBotWinning() {
        return this.scores.bot > this.scores.opponent;
    }

    /**
     * Check if bot won the game
     * @returns {boolean}
     */
    didBotWin() {
        return this.winner === 'bot';
    }

    /**
     * Get remaining rounds needed for bot to win
     * @returns {number}
     */
    getRoundsToWin() {
        return Math.max(0, this.winsNeeded - this.scores.bot);
    }

    /**
     * Get game summary
     * @returns {object}
     */
    getSummary() {
        return {
            ticketId: this.ticketId,
            winsNeeded: this.winsNeeded,
            scores: this.scores,
            rounds: this.rounds.length,
            gameComplete: this.isGameComplete(),
            winner: this.winner,
            duration: this.completedAt
                ? this.completedAt - this.startedAt
                : Date.now() - this.startedAt
        };
    }

    /**
     * Serialize for persistence
     * @returns {object}
     */
    toJSON() {
        return {
            ticketId: this.ticketId,
            winsNeeded: this.winsNeeded,
            botWinsTies: this.botWinsTies,
            scores: this.scores,
            rounds: this.rounds,
            pendingBotRoll: this.pendingBotRoll,
            startedAt: this.startedAt,
            completedAt: this.completedAt,
            winner: this.winner
        };
    }

    /**
     * Restore from persistence
     * @param {object} json
     * @returns {ScoreTracker}
     */
    static fromJSON(json) {
        const tracker = new ScoreTracker(json.ticketId, json.winsNeeded);
        tracker.botWinsTies = json.botWinsTies;
        tracker.scores = json.scores;
        tracker.rounds = json.rounds;
        tracker.pendingBotRoll = json.pendingBotRoll || null;
        tracker.startedAt = json.startedAt;
        tracker.completedAt = json.completedAt;
        tracker.winner = json.winner;
        return tracker;
    }
}

module.exports = ScoreTracker;
