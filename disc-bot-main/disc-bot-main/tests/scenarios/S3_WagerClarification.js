/**
 * S3_WagerClarification.js
 * Bot asks for clarification on ambiguous bets.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S3_WagerClarification',
    execute: async (harness, runner) => {
        const opponentId = 'opp-333';
        const ticketChannelId = 'tick-clarify-s3';

        harness.createUser(opponentId, 'AmbigousAl');

        // Phase 1: Ticket
        harness.injectChannelCreate(ticketChannelId, 'ticket-ambiguousal');
        await new Promise(r => setTimeout(r, 600));

        // Phase 2: Ambiguous Bet (No game type, no amount)
        harness.injectMessage(ticketChannelId, opponentId, 'yo want to bet?');
        await new Promise(r => setTimeout(r, 800));

        // Assert bot sends help info
        runner.assertMessageSent(ticketChannelId, /Dice Bot Info|Ready to play/i);

        // Still in AWAITING_MIDDLEMAN (it shouldn't have moved to confirm yet)
        runner.assertState(ticketChannelId, STATES.AWAITING_MIDDLEMAN);

        // Phase 3: Partial Bet
        harness.injectMessage(ticketChannelId, opponentId, '$20 dice');
        await new Promise(r => setTimeout(r, 800));

        // Bot should now provide counter-offer and ask for confirm
        runner.assertMessageSent(ticketChannelId, /confirm/i);
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // Finalize
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);
    }
};
