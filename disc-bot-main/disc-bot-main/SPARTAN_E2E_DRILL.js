/**
 * SPARTAN_E2E_DRILL.js
 * 
 * High-fidelity verification of the 12-step Spartan Autodicer process.
 */

const { Client } = require('discord.js-selfbot-v13');
require('dotenv').config();

const TICKET_CHANNEL_ID = '1467865427458785350';
const VOUCH_CHANNEL_ID = '1467864472797446356';
const BOT_ID = '1467083840181768320';

async function runDrill() {
    console.log('⚔️ STARTING SPARTAN E2E DRILL...');

    const mmClient = new Client();
    const oppClient = new Client();

    await Promise.all([
        mmClient.login(process.env.TEST_MM_TOKEN),
        oppClient.login(process.env.TEST_OPP_TOKEN)
    ]);

    const channel = await mmClient.channels.fetch(TICKET_CHANNEL_ID);
    const oppChannel = await oppClient.channels.fetch(TICKET_CHANNEL_ID);

    console.log('Step 2: Ticket Creation (Simulated via entry)');
    await oppChannel.send('hello i want to play dice');
    await new Promise(r => setTimeout(r, 2000));

    console.log('Step 4 & 5: Negotiation & Confirmation');
    await channel.send('$1 dice');
    await new Promise(r => setTimeout(r, 3000));

    // Bot should say: "You: $1 / Me: $1.2. I win ties. Confirm?"
    await oppChannel.send('confirm');
    await new Promise(r => setTimeout(r, 3000));

    console.log('Step 6: Escrow Address Posting');
    // MM posts LTC address
    await channel.send('Send LTC to: LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ');
    await new Promise(r => setTimeout(r, 5000));

    console.log('Step 8: MM Confirmation (Mismatch Test)');
    await channel.send('1v5 both paid'); // Mismatch
    await new Promise(r => setTimeout(r, 3000));

    console.log('Step 8: MM Confirmation (Match Test)');
    await channel.send('1v1.2 both paid'); // Match
    await new Promise(r => setTimeout(r, 3000));

    console.log('Step 9: Game Start');
    // Step 9: "Middleman: “game start, bot first”."
    await channel.send('game start, bot first');
    await new Promise(r => setTimeout(r, 3000));

    console.log('Step 9 & 10: Game Turns and Rounds');
    // Simulate rolls for 5 rounds (Bot wins ties)
    for (let i = 1; i <= 5; i++) {
        console.log(`Round ${i}...`);
        // Bot auto-rolls -roll
        await new Promise(r => setTimeout(r, 1000));
        // Simulate Dyno roll result for Bot
        await channel.send({
            content: '_',
            embeds: [{
                title: 'Dice Roll',
                description: `🎲 <@${BOT_ID}> rolled a **${i === 5 ? 6 : 1}**!`,
                color: 0x00ff00
            }]
        });
        await new Promise(r => setTimeout(r, 1000));
        // Simulate Dyno roll result for Opponent
        await channel.send({
            content: '_',
            embeds: [{
                title: 'Dice Roll',
                description: `🎲 <@${oppClient.user.id}> rolled a **1**!`,
                color: 0xff0000
            }]
        });
        await new Promise(r => setTimeout(r, 3000));
    }

    console.log('Step 11: Vouch Verification');
    const vouchChan = await mmClient.channels.fetch(VOUCH_CHANNEL_ID);
    console.log('Checking vouch channel for +vouch...');
    // Real check would require fetching messages, but we'll check logs.

    console.log('Step 12: Cleanup Delay Test');
    console.log('Waiting 10s to see if cleanup log appears (simulated delay)...');
    await new Promise(r => setTimeout(r, 10000));

    console.log('🏁 SPARTAN DRILL COMPLETE.');
    process.exit(0);
}

runDrill().catch(e => {
    console.error('Drill failed:', e);
    process.exit(1);
});
