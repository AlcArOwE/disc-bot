/**
 * DIAGNOSTIC SCRIPT - Run this to verify bot configuration
 * Usage: node diagnose.js
 */

const fs = require('fs');
const path = require('path');

// Load environment variables for accurate diagnostic
require('dotenv').config();

console.log('='.repeat(60));
console.log('DISC-BOT DIAGNOSTIC REPORT');
console.log('='.repeat(60));
console.log('');

// Check 1: Config file exists and is valid
console.log('📋 CHECK 1: Configuration');
console.log('-'.repeat(40));

let config;
try {
    config = require('./config.json');
    console.log('✅ config.json loaded successfully');
} catch (e) {
    console.log('❌ FAILED to load config.json:', e.message);
    process.exit(1);
}

// Check middleman IDs
const mmIds = config.middleman_ids || [];
console.log(`   Middleman IDs configured: ${mmIds.length}`);
if (mmIds.length === 0) {
    console.log('   ⚠️  WARNING: No middleman IDs configured!');
} else {
    console.log(`   First 3: ${mmIds.slice(0, 3).join(', ')}`);
}

// Check monitored channels
const monitoredChannels = config.channels?.monitored_channels || [];
console.log(`   Monitored channels: ${monitoredChannels.length}`);
if (monitoredChannels.length === 0) {
    console.log('   ℹ️  Empty = monitors ALL channels (good)');
} else {
    console.log(`   Channels: ${monitoredChannels.join(', ')}`);
}

// Check payout addresses
const ltcPayout = config.payout_addresses?.LTC || 'NOT SET';
const solPayout = config.payout_addresses?.SOL || 'NOT SET';
console.log(`   LTC Payout: ${ltcPayout}`);
console.log(`   SOL Payout: ${solPayout}`);
console.log(`   Crypto Network: ${config.crypto_network || 'NOT SET'}`);

// Check betting limits
console.log(`   Betting limits: $${config.betting_limits?.min} - $${config.betting_limits?.max}`);

console.log('');

// Check 2: Environment variables
console.log('📋 CHECK 2: Environment Variables');
console.log('-'.repeat(40));

const token = process.env.DISCORD_TOKEN;
console.log(`   DISCORD_TOKEN: ${token ? '✅ SET (' + token.length + ' chars)' : '❌ NOT SET'}`);

const ltcKey = process.env.LTC_PRIVATE_KEY;
console.log(`   LTC_PRIVATE_KEY: ${ltcKey ? '✅ SET' : '❌ NOT SET'}`);

const solKey = process.env.SOL_PRIVATE_KEY;
console.log(`   SOL_PRIVATE_KEY: ${solKey ? '✅ SET' : '⚠️  NOT SET (only needed for SOL)'}`);

const liveTransfers = process.env.ENABLE_LIVE_TRANSFERS;
console.log(`   ENABLE_LIVE_TRANSFERS: ${liveTransfers === 'true' ? '✅ ENABLED' : '⚠️  DRY-RUN MODE'}`);

console.log('');

// Check 3: Source files exist
console.log('📋 CHECK 3: Source Files');
console.log('-'.repeat(40));

const requiredFiles = [
    'src/index.js',
    'src/bot/client.js',
    'src/bot/events/messageCreate.js',
    'src/bot/events/channelCreate.js',
    'src/bot/handlers/sniper.js',
    'src/bot/handlers/ticket.js',
    'src/state/TicketManager.js',
    'src/crypto/index.js'
];

let allFilesExist = true;
for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(__dirname, file));
    console.log(`   ${exists ? '✅' : '❌'} ${file}`);
    if (!exists) allFilesExist = false;
}

console.log('');

// Check 4: Git status
console.log('📋 CHECK 4: Git Information');
console.log('-'.repeat(40));

try {
    const { execSync } = require('child_process');
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();

    console.log(`   Branch: ${branch}`);
    console.log(`   Commit: ${commit}`);
    console.log(`   Uncommitted changes: ${status ? 'YES' : 'None'}`);

    if (branch !== 'production-fix') {
        console.log(`   ⚠️  WARNING: Not on production-fix branch!`);
    }
} catch (e) {
    console.log('   ⚠️  Could not get git info:', e.message);
}

console.log('');

// Check 5: Test Discord connection
console.log('📋 CHECK 5: Discord Connection Test');
console.log('-'.repeat(40));

if (!token) {
    console.log('   ❌ Cannot test - DISCORD_TOKEN not set');
} else {
    console.log('   Testing connection... (will timeout in 10 seconds)');

    const { Client } = require('discord.js-selfbot-v13');
    const client = new Client({ checkUpdate: false });

    const timeout = setTimeout(() => {
        console.log('   ❌ Connection timed out');
        process.exit(1);
    }, 10000);

    client.on('ready', () => {
        clearTimeout(timeout);
        console.log(`   ✅ Connected as: ${client.user.tag}`);
        console.log(`   User ID: ${client.user.id}`);
        console.log(`   Guilds: ${client.guilds.cache.size}`);

        // List first 5 guilds
        const guilds = [...client.guilds.cache.values()].slice(0, 5);
        for (const guild of guilds) {
            console.log(`      - ${guild.name} (${guild.id})`);
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('='.repeat(60));
        console.log('');
        console.log('If all checks pass, run the bot with:');
        console.log('   node src/index.js');
        console.log('');
        console.log('Watch for these log messages:');
        console.log('   📨 MSG_RECEIVED - Shows every message the bot receives');
        console.log('   🎯 MIDDLEMAN MESSAGE DETECTED - MM routing working');
        console.log('   📋 Pending wager - Wager stored after snipe');
        console.log('');

        client.destroy();
        process.exit(0);
    });

    client.on('error', (err) => {
        clearTimeout(timeout);
        console.log('   ❌ Connection error:', err.message);
        process.exit(1);
    });

    client.login(token).catch(err => {
        clearTimeout(timeout);
        console.log('   ❌ Login failed:', err.message);
        process.exit(1);
    });
}
