# 🔐 Credential Setup Guide

**READ CAREFULLY. THESE STEPS ARE CRITICAL FOR YOUR SAFETY.**

## 1. Discord Account Token
The "Token" is the password your bot needs to log in as YOU. It is NOT your normal password.

### How to get it (PC/Mac):
1. Open [Discord](https://discord.com/app) in your web browser (Chrome/Edge).
2. Log in to the account you want the bot to use.
3. Press `F12` (or `Ctrl+Shift+I`) to open **Developer Tools**.
4. Go to the **Network** tab.
5. In the "Filter" box, type: `/api`
6. Click around in Discord (e.g., switch channels). You will see requests appear.
7. Click on one of the requests (like `messages` or `science`).
8. On the right, look at **Headers** -> **Request Headers**.
9. Find the line that says `authorization:`.
10. Copy that long text. **That is your Token.**
    *   *It usually looks like: `Mzls...` (lots of random letters)*

---

## 2. Litecoin (LTC) Private Key
**⚠️ DO NOT USE YOUR 12-WORD SEED PHRASE.**
**⚠️ DO NOT USE YOUR PUBLIC ADDRESS (starts with L or M).**

The bot needs the **Private Key** to send money automatically.

### What is it?
- **Public Address**: Like your Email Address (Safe to share, people send money here).
- **Seed Phrase**: Master Key for ALL your accounts (NEVER SHARE THIS).
- **Private Key**: The key for JUST ONE specific coin address. **This is what the bot needs.**

### How to get it (Example: Exodus Wallet)
1. Open Exodus.
2. Click on **Litecoin**.
3. Click the three dots `...` (top right) -> **View Private Keys**.
4. Enter your password.
5. Copy the **Private Key** (starts with `T` or similar, or WIF format).

### 🛡️ SAFETY TIP (Crucial)
**Create a NEW Wallet for this bot.**
1. Download a fresh wallet app (or make a new portfolio).
2. Send only $10-$20 to it.
3. Export the private key of *that* specific new wallet.
4. Use that key in the bot.
**Why?** If you mess up, or the bot gets hacked, you only lose $10, not your life savings.
