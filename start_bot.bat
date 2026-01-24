@echo off
title Discord Wagering Bot
echo ==========================================
echo       DISCORD WAGERING BOT LAUNCHER
echo ==========================================
echo.
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
