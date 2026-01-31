require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');

const client = new Client({
    checkUpdate: false
});

console.log('--- TOKEN LOGIN TEST (SELFBOT) ---');
console.log('Attempting to log in with token:', process.env.DISCORD_TOKEN ? 'EXISTS' : 'MISSING');

client.once('ready', () => {
    console.log(`✅ SUCCESS: Logged in as ${client.user.tag}`);
    process.exit(0);
});

client.on('error', (err) => {
    console.error('❌ LOGIN FAILED:', err.message);
    process.exit(1);
});

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: No DISCORD_TOKEN found in .env');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ ERROR: Login failed:', err.message);
    process.exit(1);
});

// Timeout after 15 seconds
setTimeout(() => {
    console.error('❌ TIMEOUT: Login took too long.');
    process.exit(1);
}, 15000);
