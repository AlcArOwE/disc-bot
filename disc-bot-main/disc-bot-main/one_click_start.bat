@echo off
setlocal enabledelayedexpansion
title Discord Wagering Bot [TOTALLITY]
color 0B

:: ==============================================================
::  DISCORD WAGERING BOT - PRODUCTION SHELL
::  Author: Antigravity
:: ==============================================================

:INIT
cd /d "%~dp0"
set RESTART_COUNT=0

:MENU
cls
echo.
echo  ══════════════════════════════════════════════════════════════
echo   DISCORD WAGERING BOT - ONE-CLICK PRODUCTION SHELL
echo  ══════════════════════════════════════════════════════════════
echo.
echo   [1] 🚀 START BOT (with Auto-Restart)
echo   [2] 🛡️  RUN DIAGNOSTICS (Sanity Check)
echo   [3] 🔄 UPDATE PROJECT (Git Sync)
echo   [4] 📝 EDIT CONFIGURATION (.env)
echo   [5] 🗑️  CLEAR CACHE (node_modules)
echo   [6] ❌ EXIT
echo.
set /p opt=" Choose an option [1-6]: "

if "%opt%"=="1" goto START_BOT
if "%opt%"=="2" goto DIAGNOSTICS
if "%opt%"=="3" goto UPDATE
if "%opt%"=="4" goto ENV_EDIT
if "%opt%"=="5" goto CLEAN
if "%opt%"=="6" exit
goto MENU

:START_BOT
cls
echo.
echo  [1/3] Verifying Environment...
if not exist .env (
    color 0C
    echo ERROR: .env file missing. Run option [4] first.
    pause
    color 0B
    goto MENU
)

echo  [2/3] Checking Dependencies...
if not exist node_modules (
    echo [INFO] Installing dependencies (this may take a minute)...
    npm install --silent
)

echo  [3/3] Launching Bot...
echo.
echo  ══════════════════════════════════════════════════════════════
echo   BOT STATUS: ACTIVE
echo   - To stop the bot, close this window or press Ctrl+C.
echo   - Logs are being written to /logs directory.
echo  ══════════════════════════════════════════════════════════════
echo.

:BOT_LOOP
set /a RESTART_COUNT+=1
node src/index.js
echo.
echo  [WARNING] Bot crashed or stopped at %TIME%
echo  [STATS] Total restarts in this session: %RESTART_COUNT%
echo.
echo  Restarting in 5 seconds... (Press Ctrl+C to abort)
timeout /t 5 >nul
goto BOT_LOOP

:DIAGNOSTICS
cls
echo.
echo  ══════════════════════════════════════════════════════════════
echo   SYSTEM DIAGNOSTICS
echo  ══════════════════════════════════════════════════════════════
echo.
node diagnose.js
echo.
echo  Diagnostics complete.
pause
goto MENU

:UPDATE
cls
echo.
echo  [INFO] Fetching latest changes from GitHub...
git fetch --all
git reset --hard origin/main
echo.
echo  [SUCCESS] Bot updated to latest perfection state.
pause
goto MENU

:ENV_EDIT
echo.
echo  [INFO] Opening .env in Notepad...
start notepad .env
goto MENU

:CLEAN
echo.
echo  [WARNING] This will delete node_modules and re-install.
set /p confirm=" Are you sure? (Y/N): "
if /i "%confirm%"=="Y" (
    echo Cleaning...
    rmdir /s /q node_modules
    npm install
    echo Cleaned and Re-installed!
)
pause
goto MENU
