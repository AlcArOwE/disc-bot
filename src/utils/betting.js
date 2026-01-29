/**
 * Betting Utilities
 */

const BigNumber = require('bignumber.js');
const config = require('../../config.json');

/**
 * Calculate our bet from opponent's bet
 * @param {number} opponentBet - Opponent's bet amount
 * @returns {string} - Our bet amount formatted
 */
function calculateOurBet(opponentBet) {
    const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
    return new BigNumber(opponentBet).times(taxMultiplier).toFixed(2);
}

module.exports = { calculateOurBet };
