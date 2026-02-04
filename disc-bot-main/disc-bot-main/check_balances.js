const { getHandler } = require('./src/crypto');
const config = require('./config.json');
require('dotenv').config();

async function check() {
    console.log('--- LTC Balance ---');
    const ltc = await getHandler('LTC').getBalance();
    console.log(ltc);

    console.log('\n--- SOL Balance ---');
    const sol = await getHandler('SOL').getBalance();
    console.log(sol);
}

check();
