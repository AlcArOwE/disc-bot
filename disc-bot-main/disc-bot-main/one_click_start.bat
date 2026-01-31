@echo off
SETLOCAL EnableDelayedExpansion

echo ═══════════════════════════════════════════════════════════════
echo           DISCORD WAGERING BOT - STARTUP
echo ═══════════════════════════════════════════════════════════════

:: Print environment info
echo Current Dir:  %CD%
echo Node Version: 
node -v
echo Git Hash:
git rev-parse --short HEAD 2>nul || echo (no git repo)

:: Check for lock file
if exist "data\bot.lock" (
    echo [!] Found bot.lock - checking if bot is already running...
    echo [!] Deleting bot.lock and foring fresh start.
    del "data\bot.lock"
)

:: Ensure data directory exists
if not exist "data" mkdir "data"

:: Start the bot
echo ───────────────────────────────────────────────────────────────
echo [INFO] Starting Bot instance...
echo ───────────────────────────────────────────────────────────────

:: Set DEBUG=1 for forensic logging as requested in Master Prompt
set DEBUG=1
node src/index.js

pause
