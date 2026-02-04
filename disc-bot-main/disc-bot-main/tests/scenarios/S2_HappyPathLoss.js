/**
 * S2_HappyPathLoss.js
 * Full E2E Happy Path where Bot Loses.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S2_HappyPathLoss',
    execute: async (harness, runner) => {
        const opponentId = 'opp-222';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-loss-s2';
        const vouchChannelId = config.channels.vouch_channel_id;
        const mmAddress = 'LY7VX5yZgVbEsL3kS9F2a8B4c5D6e7F8g9';

        harness.createUser(opponentId, 'LuckyLukas');
        harness.createUser(middlemanId, 'TrustyMM');
        harness.createChannel(vouchChannelId, 'vouches');

        // Phase 1: Ticket
        harness.injectChannelCreate(ticketChannelId, 'ticket-luckylukas');
        await new Promise(r => setTimeout(r, 600));

        // Phase 2: Bet
        harness.injectMessage(ticketChannelId, opponentId, '$5 dice ft5 vs bot');
        await new Promise(r => setTimeout(r, 800));
        runner.assertMessageSent(ticketChannelId, /confirm/i);

        // Phase 4: Confirm
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 600));

        // Phase 5: MM Address
        harness.injectMessage(ticketChannelId, middlemanId, `LTC: ${mmAddress}`);
        await new Promise(r => setTimeout(r, 1000));
        runner.assertState(ticketChannelId, STATES.PAYMENT_SENT);

        // Phase 7: Bot Confirmed
        harness.injectMessage(ticketChannelId, middlemanId, 'both in');
        await new Promise(r => setTimeout(r, 600));

        // Phase 8: Game Start
        harness.injectMessage(ticketChannelId, middlemanId, 'go');
        await new Promise(r => setTimeout(r, 600));
        runner.assertMessageSent(ticketChannelId, '-roll');

        // Phase 9: Rolls (Opponent Wins 5-0)
        for (let i = 1; i <= 5; i++) {
            harness.injectMessage(ticketChannelId, middlemanId, `${harness.user.id} rolled a 1`);
            await new Promise(r => setTimeout(r, 800));
            harness.injectMessage(ticketChannelId, middlemanId, `${opponentId} rolled a 6`);
            await new Promise(r => setTimeout(r, 800));
            if (i < 5) {
                harness.injectMessage(ticketChannelId, middlemanId, 'next');
                await new Promise(r => setTimeout(r, 600));
            }
        }

        // Phase 10: Loss Outcome
        runner.assertState(ticketChannelId, STATES.GAME_COMPLETE);
        runner.assertMessageSent(ticketChannelId, /well played|gg/i);

        // Ensure NO vouch was sent
        const vouchChannel = harness.channels.cache.get(vouchChannelId);
        const botVouches = vouchChannel.sentMessages.filter(m => m.content.includes(opponentId));
        runner.assert(botVouches.length === 0, 'Bot should not vouch for a loss');
    }
};
