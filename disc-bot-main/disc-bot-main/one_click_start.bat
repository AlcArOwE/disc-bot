@echo off
title Discord Wagering Bot - One Click Start
color 0A
echo.
echo  ============================================
echo       DISCORD WAGERING BOT - ONE CLICK START
echo  ============================================
echo.

:: Change to script directory (handles double-click from anywhere)
cd /d "%~dp0"

:: Step 1: Check Node.js
echo  [1/4] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Please download and install from:
    echo  https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER% found.
echo.

:: Step 2: Install Dependencies
echo  [2/4] Checking dependencies...
if not exist node_modules (
    echo  [INFO] First run detected. Installing dependencies...
    echo  [INFO] This may take 1-2 minutes...
    echo.
    call npm ci --silent 2>nul || call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  [ERROR] Installation failed!
        echo  Try running: npm install
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed successfully.
) else (
    echo  [OK] Dependencies already installed.
)
echo.

:: Step 3: Check .env file
echo  [3/4] Checking configuration...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        color 0E
        echo.
        echo  ============================================
        echo   IMPORTANT: .env FILE CREATED
        echo  ============================================
        echo.
        echo  A new .env file has been created.
        echo  You MUST edit it before the bot will work:
        echo.
        echo    1. Open .env in Notepad
        echo    2. Add your DISCORD_TOKEN
        echo    3. Add your LTC_PRIVATE_KEY
        echo    4. Save and close
        echo    5. Run this script again
        echo.
        echo  ============================================
        echo.
        pause
        exit /b 1
    ) else (
        color 0C
        echo  [ERROR] .env.example not found!
        echo  Please re-download the bot.
        pause
        exit /b 1
    )
)

:: Check if .env has real values (not placeholders)
findstr /C:"your_discord_token_here" .env >nul 2>&1
if %errorlevel% equ 0 (
    color 0E
    echo.
    echo  [WARNING] .env still has placeholder values!
    echo  Please edit .env and add your real credentials.
    echo.
    pause
    exit /b 1
)

if not exist config.json (
    color 0C
    echo  [ERROR] config.json is missing!
    echo  Please re-download the bot.
    pause
    exit /b 1
)
echo  [OK] Configuration verified.
echo.

:: Step 4: Start the bot
echo  [4/4] Starting Discord Wagering Bot...
echo.
echo  ============================================
echo   BOT IS RUNNING - Keep this window open!
echo  ============================================
echo.
echo  Press Ctrl+C to stop the bot.
echo.

node src/index.js

:: Bot stopped
echo.
echo  ============================================
echo   Bot has stopped.
echo  ============================================
echo.
pause
