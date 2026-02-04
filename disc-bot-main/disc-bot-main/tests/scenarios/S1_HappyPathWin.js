/**
 * S1_HappyPathWin.js
 * Full E2E Happy Path where Bot Wins.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S1_HappyPathWin',
    execute: async (harness, runner) => {
        const opponentId = 'opp-111';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-win-s1';
        const publicChannelId = 'pub-market';
        const vouchChannelId = config.channels.vouch_channel_id;
        const mmAddress = 'LY7VX5yZgVbEsL3kS9F2a8B4c5D6e7F8g9';

        // 1. Setup Actors
        harness.createUser(opponentId, 'BigBettor');
        harness.createUser(middlemanId, 'TrustyMM');
        harness.createChannel(publicChannelId, 'bet-market');
        harness.createChannel(vouchChannelId, 'vouches');

        // Phase 1: Ticket Creation
        harness.injectChannelCreate(ticketChannelId, 'ticket-bigbettor');

        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.AWAITING_MIDDLEMAN);

        // Phase 2: Bet Calculation
        harness.injectMessage(ticketChannelId, opponentId, '$10 dice ft5 vs bot, bot wins ties');

        await new Promise(r => setTimeout(r, 600));
        runner.assertMessageSent(ticketChannelId, /vs my \$12(\.00)?/);
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // Phase 4: Opponent Confirm
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // Phase 5: MM posts address
        harness.injectMessage(ticketChannelId, middlemanId, `Send to ${mmAddress}`);
        await new Promise(r => setTimeout(r, 1000)); // Payment sending takes a bit

        // Phase 6: Payment Sent
        runner.assertState(ticketChannelId, STATES.PAYMENT_SENT);
        runner.assertMessageSent(ticketChannelId, /dryrun-tx|txid/i);

        // Phase 7: MM restates bet
        harness.injectMessage(ticketChannelId, middlemanId, 'both paid, gl');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.AWAITING_GAME_START);

        // Phase 8: Game Start
        harness.injectMessage(ticketChannelId, middlemanId, 'game start, bot first');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OUR_TURN);
        runner.assertMessageSent(ticketChannelId, '-roll');

        // Phase 9: Rolls (FT5)
        // Round 1 (Bot 6, Opp 2)
        harness.injectMessage(ticketChannelId, middlemanId, `${harness.user.id} rolled a 6`);
        await new Promise(r => setTimeout(r, 800));
        harness.injectMessage(ticketChannelId, middlemanId, `${opponentId} rolled a 2`);
        await new Promise(r => setTimeout(r, 800));
        runner.assertMessageSent(ticketChannelId, /1.*-.*0/);

        // Round 2 (Bot 5, Opp 5 - Tie)
        harness.injectMessage(ticketChannelId, middlemanId, 'ur turn bot');
        await new Promise(r => setTimeout(r, 600));
        runner.assertMessageSent(ticketChannelId, '-roll');

        harness.injectMessage(ticketChannelId, middlemanId, `${harness.user.id} rolled a 5`);
        await new Promise(r => setTimeout(r, 800));
        harness.injectMessage(ticketChannelId, middlemanId, `${opponentId} rolled a 5`);
        await new Promise(r => setTimeout(r, 800));
        runner.assertMessageSent(ticketChannelId, /2.*-.*0/);

        // Finalize 5-0 
        for (let i = 3; i <= 5; i++) {
            harness.injectMessage(ticketChannelId, middlemanId, 'go');
            await new Promise(r => setTimeout(r, 600));
            harness.injectMessage(ticketChannelId, middlemanId, `${harness.user.id} rolled a 6`);
            await new Promise(r => setTimeout(r, 800));
            harness.injectMessage(ticketChannelId, middlemanId, `${opponentId} rolled a 1`);
            await new Promise(r => setTimeout(r, 800));
        }

        // Phase 10: Outcome (Win)
        runner.assertState(ticketChannelId, STATES.GAME_COMPLETE);
        runner.assertMessageSent(ticketChannelId, /LTC:/);
        runner.assertMessageSent(ticketChannelId, /SOL:/);

        // Phase 11: Vouch
        await new Promise(r => setTimeout(r, 1200));
        runner.assertMessageSent(vouchChannelId, /vouch/i);
    }
};
