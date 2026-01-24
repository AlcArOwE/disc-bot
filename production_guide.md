# Production Guide

This guide details how to deploy the bot safely and reliably.

## 1. Anti-Ban Strategy (Critical)

Running a user-bot (self-bot) is against Discord's ToS. To minimize risk, you MUST mimic a real user.

### ⛔ NEVER use Data Center IPs
Do not run this bot directly on:
- AWS, Google Cloud, Azure
- DigitalOcean, Linode, Vultr

Discord flags these IPs immediately.

### ✅ USE Residential Proxies
You must route traffic through a residential connection.
1. Buy a **Static Residential Proxy** (ISP Proxy).
   *   **Webshare**: Very cheap, easiest to start. (Select "Static Residential").
   *   **IPRoyal**: Good quality, crypto friendly.
   *   **Rayobyte**: High end, expensive but reliable.

2. **Format it correctly:**
   *   If you have User/Pass: `http://username:password@ip:port`
   *   If IP Whitelisted: `http://ip:port`

3. **Paste into `config.json`**:
   ```json
   "proxy_url": "http://myuser:mypass@123.45.67.89:8080"
   ```

### 🏠 Running on Home PC?
If you are running this on your **personal computer** at home, you technically do **not** need a proxy (leave it empty `""`). Discord sees you as a normal user.
**BUT** if you run it 24/7, a proxy is still safer.

## 2. Process Management (PM2)

Use PM2 to keep the bot running 24/7.

1. Install PM2:
   ```bash
   npm install pm2 -g
   ```

2. Start the bot:
   ```bash
   pm2 start ecosystem.config.js
   ```

3. Monitoring:
   ```bash
   pm2 monit    # Monitor CPU/RAM
   pm2 logs     # View logs
   ```

4. Enable startup (Linux):
   ```bash
   pm2 startup
   pm2 save
   ```

## 3. Wallet Security (OpSec)

### "Hot Wallet" Principle
This bot requires private keys in the `.env` file. This is a "Hot Wallet".
- **NEVER** put your life savings in this wallet.
- **NEVER** use your main holding wallet.
- **ONLY** keep what you need for the day's payouts (e.g., $100-$500).

### Withdraw Function
If you accumulate winnings:
1. Manually log into your wallet.
2. Transfer profit to your secure "Cold Wallet" (Hardware wallet).

## 4. Updates & Maintenance

To update the code:
1. `git pull`
2. `npm install`
3. `pm2 restart discord-wagering-bot`
