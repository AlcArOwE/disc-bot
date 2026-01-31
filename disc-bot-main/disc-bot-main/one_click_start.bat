@echo off
setlocal
title Discord Bot Launcher
cd /d "%~dp0"

:MENU
cls
echo.
echo  =========================================
echo     DISCORD WAGERING BOT LAUNCHER
echo  =========================================
echo.
echo     1. Start Bot
echo     2. Run Diagnostics
echo     3. Update from GitHub
echo     4. Exit
echo.
choice /c 1234 /n /m "Enter choice (1-4): "
set choice=%errorlevel%

if "%choice%"=="1" goto RUN_BOT
if "%choice%"=="2" goto DIAG
if "%choice%"=="3" goto UPDATE
if "%choice%"=="4" exit
goto MENU

:RUN_BOT
cls
echo  =========================================
echo     PRE-FLIGHT ENVIRONMENT CHECK
echo  =========================================
echo.

:: Check for .env file
if not exist .env (
    echo [WARNING] .env file is missing!
    echo Please create a .env file with your DISCORD_TOKEN and private keys.
    echo You can copy .env.example if it exists.
    echo.
    pause
    goto MENU
)

:: Check for Node.js
call node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    goto MENU
)

:: Check for NPM
call npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] NPM is not installed or not in PATH!
    pause
    goto MENU
)

:: Check dependencies
if not exist node_modules (
    echo [INFO] node_modules missing. Installing dependencies...
    echo.
    call npm install --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Installation failed!
        pause
        goto MENU
    )
)

:RESTART
cls
echo  =========================================
echo     DISCORD WAGERING BOT: ACTIVE
echo  =========================================
echo.
node src/index.js
echo.
echo [SYSTEM] Bot stopped. Restarting in 5 seconds...
echo Press Ctrl+C to stop the loop.
timeout /t 5 /nobreak >nul
goto RESTART

:DIAG
cls
echo  =========================================
echo     PRODUCTION AUDIT: RUNNING PROOFS
echo  =========================================
echo.
node NUCLEAR_AUDIT_PROOFS.js
pause
goto MENU

:UPDATE
cls
echo Updating from GitHub...
git pull origin main
pause
goto MENU
