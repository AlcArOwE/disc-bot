@echo off
setlocal enabledelayedexpansion

echo ═══════════════════════════════════════════════════════════════════
echo               DISCORD BOT - ONE CLICK START
echo ═══════════════════════════════════════════════════════════════════
echo.

REM Print current folder
echo Current folder: %CD%
echo.

REM Print Node version
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
if defined NODE_VERSION (
    echo Node version: %NODE_VERSION%
) else (
    echo ERROR: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

REM Print Git commit hash
for /f "tokens=*" %%i in ('git rev-parse --short HEAD 2^>nul') do set COMMIT_HASH=%%i
if defined COMMIT_HASH (
    echo Git commit: %COMMIT_HASH%
) else (
    echo Git commit: unknown
)
echo.

REM Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please copy .env.example to .env and configure it.
    pause
    exit /b 1
)

REM Check for lock file to prevent multiple instances
if exist "data\bot.lock" (
    echo WARNING: Lock file detected. Another instance may be running.
    echo If the previous instance crashed, delete data\bot.lock and try again.
    choice /C YN /M "Continue anyway"
    if errorlevel 2 exit /b 1
)

REM Print safety mode
findstr /C:"ENABLE_LIVE_TRANSFERS=true" .env >nul 2>&1
if errorlevel 1 (
    echo Mode: DRY RUN (no real transfers)
) else (
    echo Mode: LIVE TRANSFERS ENABLED
    echo *** WARNING: Real money transfers are active! ***
)
echo.

REM Print debug mode
findstr /C:"DEBUG=1" .env >nul 2>&1
if errorlevel 1 (
    echo Debug: OFF
) else (
    echo Debug: ON
)
echo.

echo ═══════════════════════════════════════════════════════════════════
echo Starting bot...
echo ═══════════════════════════════════════════════════════════════════
echo.

REM Start the bot
node src/index.js

REM Cleanup on exit
if exist "data\bot.lock" del "data\bot.lock"

echo.
echo Bot stopped.
pause
