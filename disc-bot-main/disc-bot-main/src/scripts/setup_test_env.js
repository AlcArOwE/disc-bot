require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');

const client = new Client();

async function run() {
    try {
        console.log('Logging in...');
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`Logged in as ${client.user.tag}`);

        const guildName = "Spartan Autodicer's server";
        const guild = client.guilds.cache.find(g => g.name === guildName);

        if (!guild) {
            console.error(`Could not find guild: ${guildName}`);
            console.log('Available guilds:');
            client.guilds.cache.forEach(g => console.log(`- ${g.name} (${g.id})`));
            process.exit(1);
        }

        console.log(`Found guild: ${guild.name} (${guild.id})`);

        // Roles to create
        const roles = [
            { name: 'Middleman', color: '#3498db' },
            { name: 'Player', color: '#2ecc71' },
            { name: 'Highroller', color: '#f1c40f' }
        ];

        // Professional Role Assignment (Multi-Account Simulation)
        const middlemanRole = guild.roles.cache.find(r => r.name === 'Middleman');
        const playerRole = guild.roles.cache.find(r => r.name === 'Player');

        const accounts = [
            { id: '1422059455482433579', roles: ['Middleman'] }, // 3yyp
            { id: '1467123040390480046', roles: ['Middleman'] }, // hexdicer (Secondary MM)
            { id: '1205744645284429834', roles: ['Player'] }     // backatharlem (Opponent)
        ];

        for (const acc of accounts) {
            try {
                const member = await guild.members.fetch(acc.id).catch(() => null);
                if (member) {
                    for (const roleName of acc.roles) {
                        const role = guild.roles.cache.find(r => r.name === roleName);
                        if (role) {
                            console.log(`Granting ${roleName} role to ${member.user.tag}...`);
                            await member.roles.add(role);
                        }
                    }
                }
            } catch (e) {
                console.log(`Failed to grant roles to ${acc.id}: ${e.message}`);
            }
        }

        // Grant roles to Dyno/Ticket Tool
        const botIds = ['155149108183695360', '557628352828014614'];
        if (middlemanRole) {
            for (const bId of botIds) {
                try {
                    const member = await guild.members.fetch(bId).catch(() => null);
                    if (member) {
                        console.log(`Granting Middleman role to ${member.user.tag}...`);
                        await member.roles.add(middlemanRole);
                    }
                } catch (e) {
                    console.log(`Failed to grant role to bot ID ${bId}: ${e.message}`);
                }
            }
        }

        // Structure to create
        const structure = [
            {
                name: '🏛・INFO', type: 'GUILD_CATEGORY', channels: [
                    { name: 'start-here', type: 'GUILD_TEXT' },
                    { name: 'how-to-bet', type: 'GUILD_TEXT' }
                ]
            },
            {
                name: '🎲・CASINO', type: 'GUILD_CATEGORY', channels: [
                    { name: 'casual-chat', type: 'GUILD_TEXT' },
                    { name: 'bet-market', type: 'GUILD_TEXT' }
                ]
            },
            { name: '🎟・TICKETS', type: 'GUILD_CATEGORY', channels: [] },
            {
                name: '✅・VOUCHES', type: 'GUILD_CATEGORY', channels: [
                    { name: 'vouch', type: 'GUILD_TEXT' }
                ]
            },
            {
                name: '🤖・BOT-DEBUG', type: 'GUILD_CATEGORY', channels: [
                    { name: 'bot-logs', type: 'GUILD_TEXT' },
                    { name: 'test-scripts', type: 'GUILD_TEXT' }
                ]
            }
        ];

        for (const cat of structure) {
            let category = guild.channels.cache.find(c => c.name === cat.name && c.type === 'GUILD_CATEGORY');
            if (!category) {
                console.log(`Creating category: ${cat.name}`);
                category = await guild.channels.create(cat.name, { type: 'GUILD_CATEGORY' });
            } else {
                console.log(`Category ${cat.name} already exists.`);
            }

            for (const ch of cat.channels) {
                const existingChannel = guild.channels.cache.find(c => c.name === ch.name && c.parentId === category.id);
                if (!existingChannel) {
                    console.log(`Creating channel: ${ch.name} in ${cat.name}`);
                    await guild.channels.create(ch.name, { type: ch.type, parent: category.id });
                } else {
                    console.log(`Channel ${ch.name} already exists in ${cat.name}.`);
                }
            }
        }

        const logChannels = [
            { name: 'bet-market', key: 'ADVERTISING_CHANNEL_ID' },
            { name: 'vouch', key: 'VOUCH_CHANNEL_ID' },
            { name: 'bot-logs', key: 'DEBUG_CHANNEL_ID' }
        ];

        console.log('\n--- CHANNEL & ROLE IDs FOR CONFIG ---');
        console.log(`ADVERTISING_CHANNEL_ID=${guild.channels.cache.find(c => c.name === 'bet-market')?.id}`);
        console.log(`VOUCH_CHANNEL_ID=${guild.channels.cache.find(c => c.name === 'vouch')?.id}`);
        console.log(`DEBUG_CHANNEL_ID=${guild.channels.cache.find(c => c.name === 'bot-logs')?.id}`);
        console.log(`TICKETS_CATEGORY_ID=${guild.channels.cache.find(c => c.name === '🎟・TICKETS' && c.type === 'GUILD_CATEGORY')?.id}`);
        console.log(`MIDDLEMAN_ROLE_ID=${guild.roles.cache.find(r => r.name === 'Middleman')?.id}`);

        const testScriptsChannel = guild.channels.cache.find(c => c.name === 'test-scripts' && c.type === 'GUILD_TEXT');
        if (testScriptsChannel) {
            console.log('Posting test scripts...');
            await testScriptsChannel.send(`**DAHOOD CASINO TEST SCRIPTS**
            
**Script 1: Single $1 bet (bot wins)**
1. Opponent in #bet-market: "$1 dice"
2. Middleman in #bet-market: "!claim @opponent"
3. Bot creates ticket, everyone enters.
4. Inside ticket:
   - Middleman: "state terms"
   - Opponent: "$1 dice"
   - Bot: "vs my $1.20 I win ties (dice,ft5,LTC)"
   - Opponent: "confirm"
   - Middleman: "Send LTC to: <address>"
   - Bot: [Stays silent/waits for payment detection]
   - Middleman: "1v1.2 both paid"
   - Middleman: "game start, bot first"
   - Bot: rolls via -roll
   - Play out FT5 until bot wins.
   - Bot posts payout info.
   - Opponent: vouches in #vouch

**Script 2: $10 bet (bot loses)**
- Same as above, but play until player wins. 
- Bot should post its "humble loss" message.

**Script 3: Tie Scenario**
- Force a tie in the final round. 
- Confirm bot claims win based on "bot wins ties" rule.`);
        }

        const startHereChannel = guild.channels.cache.find(c => c.name === 'start-here' && c.type === 'GUILD_TEXT');
        if (startHereChannel) {
            console.log('Posting start-here info...');
            await startHereChannel.send(`**WELCOME TO THE SPARTAN AUTODICER TEST ENVIRONMENT**
            
This server is designed to replicate Dahood-style casino workflows for realistic bot testing.

**Roles:**
- <@&${guild.roles.cache.find(r => r.name === 'Middleman')?.id}>: Use \`!claim @player\` in #bet-market to open tickets.
- <@&${guild.roles.cache.find(r => r.name === 'Player')?.id}>: Advertise bets in #bet-market (e.g., "$10 dice").

**Test Guidelines:**
1. Only the Spartan Autodicer bot is automated.
2. Middlemen and Opponents must interact manually via the Discord UI.
3. Report any "null split" crashes in #bot-logs.`);
        }

        console.log('Setup completed successfully!');
    } catch (error) {
        console.error('Setup failed:', error);
        process.exit(1);
    }
}

run();
