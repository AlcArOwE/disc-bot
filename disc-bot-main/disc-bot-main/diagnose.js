/**
 * DIAGNOSE.js
 * Comprehensive diagnostic suite for the Discord Bot.
 * Runs standard tests and the Nuclear Certification.
 */

const { execSync } = require('child_process');
const { logger } = require('./src/utils/logger');

function run(command, title) {
    console.log(`\n═══ [DIAGNOSTIC] ${title} ═══`);
    try {
        execSync(command, { stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error(`\n❌ ${title} FAILED`);
        return false;
    }
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                   BOT PRODUCTION DIAGNOSTICS                      ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    const basicTests = run('npm test', 'Standard Logic Tests');
    const nuclearTests = run('node NUCLEAR_FINAL_TEST.js', 'Nuclear Stress & Concurrency Tests');

    if (basicTests && nuclearTests) {
        console.log('\n✅ ALL DIAGNOSTICS PASSED: BOT IS PRODUCTION READY 🚀');
    } else {
        console.error('\n⚠️ DIAGNOSTICS FAILED: Please check the logs above.');
        process.exit(1);
    }
}

main().catch(console.error);
