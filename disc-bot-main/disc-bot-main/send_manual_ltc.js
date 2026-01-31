require('dotenv').config();
const LitecoinHandler = require('./src/crypto/LitecoinHandler');
const { priceOracle } = require('./src/crypto/PriceOracle');
const { logger } = require('./src/utils/logger');

async function sendManual() {
    console.log('--- MANUAL USD-TO-LTC SEND ---');
    const recipient = 'LSkrNCeAC2QtJ6h6zKNAa5MFNCVvwB9n3A';
    const usdAmount = 3;

    console.log(`Target: ${recipient}`);
    console.log(`Amount: $${usdAmount} USD`);

    const handler = new LitecoinHandler();

    console.log('Fetching price...');
    const ltcAmount = await priceOracle.convertUsdToCrypto(usdAmount, 'LTC');
    console.log(`Price conversion: $${usdAmount} = ~${ltcAmount.toFixed(8)} LTC`);

    console.log('Fetching balance...');
    const balanceInfo = await handler.getBalance();
    console.log(`Current Balance: ${balanceInfo.balance} LTC`);

    if (balanceInfo.error) {
        console.error(`Error fetching balance: ${balanceInfo.error}`);
        process.exit(1);
    }

    if (balanceInfo.balance < ltcAmount + 0.001) {
        console.error(`Insufficient balance. Need ~${(ltcAmount + 0.001).toFixed(8)} LTC (with fee), have ${balanceInfo.balance} LTC.`);
        process.exit(1);
    }

    console.log('Sending payment...');
    const result = await handler.sendPayment(recipient, ltcAmount);

    if (result.success) {
        console.log('✅ SUCCESS!');
        console.log(`Transaction ID: ${result.txId}`);
        console.log(`Explorer: https://live.blockcypher.com/ltc/tx/${result.txId}/`);
    } else {
        console.error(`❌ FAILED: ${result.error}`);
    }
}

sendManual().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
