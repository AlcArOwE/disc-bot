/**
 * S5_SolanaSupport.js
 * 
 * Verifies that the bot can detect a Solana (SOL) wager and 
 * correctly execute a payment on the Solana network.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S5_SolanaSupport',
    description: 'Verify SOL wagering and payment',
    async execute(harness, runner) {
        const opponentId = 'opp-555';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-sol-s5';
        const solAddress = 'vines1vzrYbzLMRdu58syAY2wwswgnfhhix76z7pQy4';

        harness.createUser(opponentId, 'SolanaSultan');
        harness.createUser(middlemanId, 'TrustyMM');

        // 1. Create ticket and propose SOL wager
        harness.injectChannelCreate(ticketChannelId, 'ticket-solanasultan');

        // Wait for bot to auto-create and transition to AWAITING_MIDDLEMAN
        await new Promise(r => setTimeout(r, 1000));

        // Propose SOL wager
        harness.injectMessage(ticketChannelId, opponentId, '$10 SOL dice ft5');
        await new Promise(r => setTimeout(r, 1000));

        // Assert bot accepted and offered counter in SOL (or at least acknowledge it)
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // 2. Opponent confirms
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 1000));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // 3. MM provides SOL address
        harness.injectMessage(ticketChannelId, middlemanId, `SOL: ${solAddress}`);
        await new Promise(r => setTimeout(r, 1500));

        // 4. Assert payment sent (should use SolanaHandler)
        runner.assertState(ticketChannelId, STATES.PAYMENT_SENT);

        // Verify payment TXID format (generic for dryrun)
        runner.assertMessageSent(ticketChannelId, /Sent \$12.*TXID: dryrun-tx/i);

        console.log('✅ S5: Solana detection and payment verified.');
    }
};
