/**
 * S7_RoundTieLogic.js
 * 
 * Verifies that the bot correctly handles round ties and 
 * wins them as per configuration ("bot wins ties").
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S7_RoundTieLogic',
    description: 'Verify round tie-win logic',
    async execute(harness, runner) {
        const opponentId = 'opp-777';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-tie-s7';

        harness.createUser(opponentId, 'TieTerrace');
        harness.createUser(middlemanId, 'TrustyMM');

        // 1. Setup ticket and advance to Game Start
        harness.injectChannelCreate(ticketChannelId, 'ticket-tie-test');
        await new Promise(r => setTimeout(r, 600));
        harness.injectMessage(ticketChannelId, opponentId, '$10 dice ft5');
        await new Promise(r => setTimeout(r, 600));
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 600));

        // Skip address (shortcut via MM confirm)
        harness.injectMessage(ticketChannelId, middlemanId, 'both paid');
        await new Promise(r => setTimeout(r, 600));

        // Start game
        harness.injectMessage(ticketChannelId, middlemanId, 'game start, bot first');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OUR_TURN);

        // 2. Play a TIE round
        // Bot rolls 5
        harness.injectMessage(ticketChannelId, middlemanId, `${harness.user.id} rolled a 5`);
        await new Promise(r => setTimeout(r, 600));
        // Opponent rolls 5
        harness.injectMessage(ticketChannelId, middlemanId, `${opponentId} rolled a 5`);
        await new Promise(r => setTimeout(r, 800));

        // Assert bot won the round (Score 1-0)
        runner.assertMessageSent(ticketChannelId, /⚄ \*\*5\*\* vs ⚄ \*\*5\*\* - I win! \(\*\*1\*\* - \*\*0\*\*\)/i);

        console.log('✅ S7: Tie-win logic verified.');
    }
};
