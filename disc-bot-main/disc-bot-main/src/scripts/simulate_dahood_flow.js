require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { logger } = require('../utils/logger');

const client = new Client();

// Configuration from previous steps
const GUILD_ID = "1467858063594754212";
const BET_MARKET_ID = "1467864467499909202";
const MM_ROLE_ID = "1467864454199775455";

async function runSimulation() {
    try {
        console.log('Starting Full Dahood Simulation...');
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`Simulating as: ${client.user.tag}`);

        const guild = await client.guilds.fetch(GUILD_ID);
        const betMarket = await guild.channels.fetch(BET_MARKET_ID);

        // --- STEP 1: Post a bet as the Opponent ---
        console.log('Step 1: Posting bet in #bet-market...');
        await betMarket.send("$1 dice ft5");

        // Wait for bot to see it (manual delay for realism)
        await new Promise(r => setTimeout(r, 3000));

        // --- STEP 2: Claim the bet as Middleman ---
        console.log('Step 2: Claiming bet as Middleman...');
        // We use !claim @me to trigger our own handler which creates the ticket
        await betMarket.send(`!claim <@${client.user.id}>`);

        // Wait for ticket creation with retry
        let ticketChannel = null;
        console.log('Step 3: Waiting for ticket channel to appear...');
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            // Force fetch to bypass cache
            const channels = await guild.channels.fetch();
            ticketChannel = channels
                .filter(c => c.name.startsWith('ticket-'))
                .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                .first();

            if (ticketChannel) break;
            console.log(`Still waiting... (${i + 1}/10)`);
        }

        if (!ticketChannel) {
            console.error('Failed to find created ticket channel.');
            process.exit(1);
        }

        console.log(`Step 3: Found ticket channel: ${ticketChannel.name}. Entering...`);

        // --- STEP 4: State terms in ticket ---
        await new Promise(r => setTimeout(r, 3000));
        console.log('Step 4: Stating terms...');
        await ticketChannel.send(`$1 dice ft5 vs bot, bot wins ties`);

        // Wait for bot to confirm
        await new Promise(r => setTimeout(r, 4000));

        // --- STEP 5: Confirm terms as Opponent ---
        console.log('Step 5: Confirming terms...');
        await ticketChannel.send("confirm");

        // --- STEP 6: Simulate Middleman providing LTC address ---
        await new Promise(r => setTimeout(r, 3000));
        console.log('Step 6: Posting LTC address...');
        await ticketChannel.send("Send LTC to: `LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ` (Bot Payout Addr)");

        // --- STEP 7: Confirm both paid ---
        await new Promise(r => setTimeout(r, 5000));
        console.log('Step 7: Confirming payment received...');
        await ticketChannel.send("both paid, gl");

        // --- STEP 8: Game Start ---
        await new Promise(r => setTimeout(r, 2000));
        console.log('Step 8: Starting game...');
        await ticketChannel.send("game start, bot first");

        console.log('Simulation reaching game phase. Observe bot rolling and state transitions in console.');

        // Keep script alive to watch rolls
        setTimeout(() => {
            console.log('Simulation timeframe completed.');
            process.exit(0);
        }, 60000);

    } catch (error) {
        console.error('Simulation Failed:', error);
        process.exit(1);
    }
}

runSimulation();
