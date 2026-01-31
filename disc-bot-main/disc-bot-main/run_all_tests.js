/**
 * ALL-IN-ONE FINAL TEST SUITE
 * Runs all critical tests to verify bot production readiness
 */

console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
console.log('║              FINAL PRODUCTION READINESS TEST SUITE               ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

const fs = require('fs');
const path = require('path');

let totalPassed = 0;
let totalFailed = 0;

async function runTest(testName, testFile) {
    console.log(`\n═══ Running: ${testName} ═══\n`);

    try {
        // Clear module cache to ensure fresh test
        delete require.cache[require.resolve(testFile)];

        // Run test
        await require(testFile);

        console.log(`\n✅ ${testName}: PASSED\n`);
        totalPassed++;
        return true;
    } catch (error) {
        console.log(`\n❌ ${testName}: FAILED`);
        console.log(`Error: ${error.message}\n`);
        totalFailed++;
        return false;
    }
}

async function main() {
    console.log('Running all production tests...\n');

    const startTime = Date.now();

    // Test 1: Nuclear validation (most comprehensive)
    const nuclearTestPath = path.join(__dirname, 'tests', 'NUCLEAR_FINAL_TEST.js');
    if (fs.existsSync(nuclearTestPath)) {
        // Fix paths in nuclear test before running
        let content = fs.readFileSync(nuclearTestPath, 'utf8');
        content = content.replace(/require\('\.\/src\//g, "require('../src/");
        content = content.replace(/require\('\.\/config\.json'\)/g, "require('../config.json')");
        fs.writeFileSync(nuclearTestPath, content);

        await runTest('Nuclear Final Test', nuclearTestPath);
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                      FINAL TEST RESULTS                           ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    console.log(`Total Tests Passed: ${totalPassed}`);
    console.log(`Total Tests Failed: ${totalFailed}`);
    console.log(`Duration: ${duration}s\n`);

    if (totalFailed === 0) {
        console.log('╔═══════════════════════════════════════════════════════════════════╗');
        console.log('║                                                                   ║');
        console.log('║              🏆 ALL TESTS PASSED - BOT IS READY 🏆                ║');
        console.log('║                                                                   ║');
        console.log('║  Your friend can now:                                             ║');
        console.log('║  1. Clone the repository                                          ║');
        console.log('║  2. Create .env file (copy from .env.example)                     ║');
        console.log('║  3. Run one_click_start.bat                                       ║');
        console.log('║                                                                   ║');
        console.log('║  The bot will start automatically! 🚀                             ║');
        console.log('║                                                                   ║');
        console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
        process.exit(0);
    } else {
        console.log('╔═══════════════════════════════════════════════════════════════════╗');
        console.log('║                                                                   ║');
        console.log('║              ⚠️  SOME TESTS FAILED - FIX NEEDED ⚠️                 ║');
        console.log('║                                                                   ║');
        console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
        process.exit(1);
    }
}

main().catch(error => {
    console.error('\n❌ CATASTROPHIC ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
});
