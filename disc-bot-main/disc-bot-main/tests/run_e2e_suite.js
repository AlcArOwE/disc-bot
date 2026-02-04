/**
 * run_e2e_suite.js
 * Entry point for the continuous E2E simulation.
 * Dynamically loads and runs all scenarios.
 */

const fs = require('fs');
const path = require('path');
const { TestRunner } = require('./harness/TestRunner');

async function run() {
    const runner = new TestRunner();
    const scenariosDir = path.join(__dirname, 'scenarios');

    // Discover scenarios
    const scenarioFiles = fs.readdirSync(scenariosDir)
        .filter(f => f.endsWith('.js'))
        .sort(); // Run in order S1, S2, S3...

    console.log(`🚀 INITIALIZING E2E SIMULATION SUITE (${scenarioFiles.length} scenarios found)...`);

    for (const file of scenarioFiles) {
        const scenarioPath = path.join(scenariosDir, file);
        const scenario = require(scenarioPath);
        await runner.runScenario(scenario);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   E2E SUITE RESULTS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   TOTAL:    ${runner.results.total}`);
    console.log(`   PASSED:   ${runner.results.passed}`);
    console.log(`   FAILED:   ${runner.results.failed}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (runner.results.failed > 0) {
        console.error('❌ SOME SCENARIOS FAILED:');
        runner.results.failures.forEach(f => {
            console.error(`  - ${f.scenario}: ${f.error}`);
        });
        process.exit(1);
    } else {
        console.log('✅ ALL SCENARIOS PASSED!');
        process.exit(0);
    }
}

run().catch(err => {
    console.error('CRITICAL SUITE FAILURE:', err);
    process.exit(1);
});
