@echo off
title Install Bot Dependencies
echo ==========================================
echo      INSTALLING REQUIRED LIBRARIES
echo ==========================================
echo.

:: Check for NPM
call npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] NPM is not installed or not in PATH!
    echo Please install Node.js - which includes NPM - from https://nodejs.org/
    echo.
    pause
    exit
)

echo Installing... (This might take a minute)
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation failed!
    pause
    exit
)

echo.
echo ==========================================
echo Installation complete!
echo You can now run start_bot.bat
echo ==========================================
pause
