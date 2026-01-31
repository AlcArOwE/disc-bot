require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');

const client = new Client({
    checkUpdate: false
});

client.once('ready', async () => {
    console.log(`--- BOT STATUS REPORT ---`);
    console.log(`User: ${client.user.tag} (${client.user.id})`);
    console.log(`Guilds: ${client.guilds.cache.size}`);

    client.guilds.cache.forEach(guild => {
        console.log(` - ${guild.name} (${guild.id})`);
    });

    console.log(`Channels: ${client.channels.cache.size}`);
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
