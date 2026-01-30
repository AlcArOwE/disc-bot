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
set "choice="
set /p choice=Enter choice (1-4): 

if "%choice%"=="1" goto RUN_BOT
if "%choice%"=="2" goto DIAG
if "%choice%"=="3" goto UPDATE
if "%choice%"=="4" exit
goto MENU

:RUN_BOT
cls
echo Starting bot...
echo.
if not exist node_modules call npm install
:RESTART
node src/index.js
echo.
echo Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto RESTART

:DIAG
cls
node diagnose.js
pause
goto MENU

:UPDATE
cls
echo Updating from GitHub...
git pull origin main
pause
goto MENU
