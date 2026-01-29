@echo off
title Discord Wagering Bot
echo ==========================================
echo       DISCORD WAGERING BOT LAUNCHER
echo ==========================================
echo.

:: Check for Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit
)

:: Check for .env and create if missing
if not exist .env (
    if exist .env.example (
        echo [INFO] .env file not found. Creating from .env.example...
        copy .env.example .env >nul
        echo [WARN] A new .env file has been created.
        echo Please edit .env and add your DISCORD_TOKEN before starting.
        echo.
        pause
        exit
    ) else (
        echo [ERROR] .env file is missing and .env.example not found!
        echo.
        pause
        exit
    )
)

echo Starting bot... (Keep this window OPEN)
echo.
if not exist node_modules (
    echo [ERROR] node_modules folder is missing!
    echo.
    echo Please double-click 'install.bat' first to download dependencies.
    echo.
    pause
    exit
)

node src/index.js
echo.
echo ==========================================
echo Bot has stopped.
echo ==========================================
pause
