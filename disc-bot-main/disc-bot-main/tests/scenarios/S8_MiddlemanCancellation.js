/**
 * S8_MiddlemanCancellation.js
 * 
 * Verifies that a middleman can reset or cancel a ticket using keywords.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S8_MiddlemanCancellation',
    description: 'Verify MM cancellation and reset keywords',
    async execute(harness, runner) {
        const opponentId = 'opp-888';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-cancel-s8';

        harness.createUser(opponentId, 'QuitterQuentin');
        harness.createUser(middlemanId, 'TrustyMM');

        // 1. Setup ticket and confirm bet
        harness.injectChannelCreate(ticketChannelId, 'ticket-quitter');
        await new Promise(r => setTimeout(r, 500));
        harness.injectMessage(ticketChannelId, opponentId, '$10 dice');
        await new Promise(r => setTimeout(r, 500));
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 500));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // 2. MM sends "reset"
        harness.injectMessage(ticketChannelId, middlemanId, 'reset');
        await new Promise(r => setTimeout(r, 1000));

        // Assert state reset to AWAITING_MIDDLEMAN
        runner.assertState(ticketChannelId, STATES.AWAITING_MIDDLEMAN);
        runner.assertMessageSent(ticketChannelId, /reset to AWAITING_MIDDLEMAN/i);

        // 3. Re-advance to confirm
        harness.injectMessage(ticketChannelId, opponentId, '$20 dice');
        await new Promise(r => setTimeout(r, 500));
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // 4. MM sends "void" (cancel)
        harness.injectMessage(ticketChannelId, middlemanId, 'void');
        await new Promise(r => setTimeout(r, 1000));

        // Assert state is CANCELLED
        runner.assertState(ticketChannelId, STATES.CANCELLED);
        runner.assertMessageSent(ticketChannelId, /Ticket cancelled/i);

        console.log('✅ S8: Middleman cancellation and reset verified.');
    }
};
