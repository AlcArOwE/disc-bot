@echo off
title ONE CLICK START (Installer + Launcher)
echo ==========================================
echo        ONE CLICK START - Discord Bot
echo ==========================================
echo.

:: 1. Check Node.js
echo [1/4] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install from https://nodejs.org/
    echo.
    pause
    exit
)
echo [OK] Node.js found.
echo.

:: 2. Install Dependencies (if needed)
echo [2/4] Checking dependencies...
if not exist node_modules (
    echo Modules missing. Installing now...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed!
        pause
        exit
    )
    echo [OK] Installation complete.
) else (
    echo [OK] Dependencies already installed.
)
echo.

:: 3. Check Config & Env
echo [3/4] Checking configuration...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [WARN] Created .env file. Please edit it!
    )
)
if not exist config.json (
    if exist config.example.json (
        copy config.example.json config.json >nul
        echo [WARN] Created config.json file. Please edit it!
    )
)
echo [OK] Config checks done.
echo.

:: 4. Start Bot
echo [4/4] Starting bot...
echo.
node src/index.js
echo.
echo ==========================================
echo Bot stopped.
pause
