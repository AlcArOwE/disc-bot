/**
 * S9_OpponentCancellation.js
 * 
 * Verifies that the bot doesn't allow opponents to cancel tickets 
 * using MM-specific keywords like "void" or "reset".
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S9_OpponentCancellation',
    description: 'Verify opponent cannot use MM keywords',
    async execute(harness, runner) {
        const opponentId = 'opp-999';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-security-s9';

        harness.createUser(opponentId, 'SneakySid');
        harness.createUser(middlemanId, 'TrustyMM');

        // 1. Setup ticket
        harness.injectChannelCreate(ticketChannelId, 'ticket-sneaky');
        await new Promise(r => setTimeout(r, 600));
        harness.injectMessage(ticketChannelId, opponentId, '$10 dice');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // 2. Opponent tries to "void"
        harness.injectMessage(ticketChannelId, opponentId, 'void');
        await new Promise(r => setTimeout(r, 800));

        // Assert state is STILL WAITING_FOR_OPPONENT_CONFIRM
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // 3. Opponent tries to "reset"
        harness.injectMessage(ticketChannelId, opponentId, 'reset');
        await new Promise(r => setTimeout(r, 800));
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        console.log('✅ S9: Opponent security check (MM keywords blocked) verified.');
    }
};
