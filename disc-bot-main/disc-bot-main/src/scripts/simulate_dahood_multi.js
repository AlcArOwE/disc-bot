require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');

// IDs from our environment
const GUILD_ID = "1467858063594754212";
const BET_MARKET_ID = "1467864467499909202";
const BOT_ID = "1422059455482433579";

async function runMultiSimulation() {
    // 1. Initialize Clients
    const mmClient = new Client({ checkUpdate: false });
    const oppClient = new Client({ checkUpdate: false });

    try {
        console.log('--- DAHOOD PRO-SIMULATION: INITIALIZING ---');

        // Parallel Login
        await Promise.all([
            mmClient.login(process.env.TEST_MM_TOKEN),
            oppClient.login(process.env.TEST_OPP_TOKEN)
        ]);

        console.log(`[AUTH] Middleman: ${mmClient.user.tag}`);
        console.log(`[AUTH] Opponent:  ${oppClient.user.tag}`);

        const guild = await mmClient.guilds.fetch(GUILD_ID);
        const betMarketOpp = await oppClient.channels.fetch(BET_MARKET_ID);
        const betMarketMM = await mmClient.channels.fetch(BET_MARKET_ID);

        // --- STEP 1: Opponent posts bet ---
        console.log('[OPPONENT] Posting bet in #bet-market...');
        await betMarketOpp.send("$1 dice ft5");
        await new Promise(r => setTimeout(r, 4000));

        // --- STEP 2: Middleman claims bet ---
        console.log('[MIDDLEMAN] Claiming bet...');
        await betMarketMM.send(`!claim <@${oppClient.user.id}>`);

        // --- STEP 3: Find the created ticket channel ---
        console.log('[SYSTEM] Waiting for ticket creation...');
        let ticketChannelMM = null;
        let ticketChannelOpp = null;

        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const channels = await guild.channels.fetch();
            const ticket = channels
                .filter(c => c.name.startsWith('ticket-'))
                .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                .first();

            if (ticket) {
                ticketChannelMM = await mmClient.channels.fetch(ticket.id);
                ticketChannelOpp = await oppClient.channels.fetch(ticket.id);
                break;
            }
            console.log(`... waiting for ticket (${i + 1}/15)`);
        }

        if (!ticketChannelMM) throw new Error("Ticket was never created or found!");
        console.log(`[SYSTEM] Ticket detected: ${ticketChannelMM.name}`);

        // --- STEP 4: Middleman states terms ---
        await new Promise(r => setTimeout(r, 3000));
        console.log('[MIDDLEMAN] Stating terms...');
        await ticketChannelMM.send(`$1 dice ft5 vs bot, bot wins ties`);

        // Wait for Bot to respond to terms (it should offer its terms)
        await new Promise(r => setTimeout(r, 5000));

        // --- STEP 5: Opponent confirms terms ---
        console.log('[OPPONENT] Confirming terms...');
        await ticketChannelOpp.send("confirm");

        // Wait for Bot to notice confirmation and potentially transition state
        await new Promise(r => setTimeout(r, 4000));

        // --- STEP 6: Middleman provides escrow LTC address ---
        console.log('[MIDDLEMAN] Posting LTC address...');
        // Use a valid Legacy LTC address (L-prefix, 26-33 chars) - NO backticks
        await ticketChannelMM.send("Send LTC to: LXvKp1VkPvMTZE8oGeCuBJr4hUGJXAkbQp (MM Escrow)");

        // --- STEP 7: Middleman confirms both payed ---
        await new Promise(r => setTimeout(r, 6000));
        console.log('[MIDDLEMAN] Confirming payment receipt...');
        await ticketChannelMM.send("both paid, gl");

        // --- STEP 8: Start the Game ---
        await new Promise(r => setTimeout(r, 3000));
        console.log('[MIDDLEMAN] Starting game...');
        await ticketChannelMM.send("game start, bot first");

        console.log('--- SIMULATION ACTIVE: OBSERVING GAMEPLAY ---');

        // Watch for bot rolls and respond as a middleman/Dyno
        mmClient.on('messageCreate', async (msg) => {
            try {
                if (!ticketChannelMM || msg.channel.id !== ticketChannelMM.id) return;
                if (msg.author.bot) return; // Selfbot check
                if (msg.author.id === mmClient.user.id) return; // Don't respond to ourselves

                if (msg.content.includes('-roll')) {
                    console.log(`[SYSTEM] Bot rolled: ${msg.content}`);
                    const botVal = Math.floor(Math.random() * 100) + 1;
                    const oppVal = Math.floor(Math.random() * 100) + 1;

                    await new Promise(r => setTimeout(r, 1500));
                    await ticketChannelMM.send(`${BOT_ID} rolled a ${botVal}`);
                    await new Promise(r => setTimeout(r, 1000));
                    await ticketChannelMM.send(`${oppClient.user.id} rolled a ${oppVal}`);
                    console.log(`[MM] Posted rolls: Bot ${botVal}, Opponent ${oppVal}`);
                }
            } catch (err) {
                console.error('!!! ERROR IN MM LISTENER !!!', err);
            }
        });

        // Watch for game completion
        mmClient.on('messageCreate', async (msg) => {
            try {
                if (!ticketChannelMM || msg.channel.id !== ticketChannelMM.id) return;
                if (msg.content.toLowerCase().includes('good game') || msg.content.toLowerCase().includes('gg')) {
                    console.log(`[SYSTEM] Game completed detection: ${msg.content}`);
                    console.log('--- SUCCESSFUL E2E RUN! ---');
                    process.exit(0);
                }
            } catch (err) {
                console.error('!!! ERROR IN GG LISTENER !!!', err);
            }
        });

        // Watch for 2 minutes to see rolls
        setTimeout(() => {
            console.log('--- SIMULATION TIMEOUT REACHED ---');
            process.exit(0);
        }, 120000);

    } catch (error) {
        console.error('!!! SIMULATION CRASHED !!!');
        console.error(error);
        process.exit(1);
    }
}

runMultiSimulation();
