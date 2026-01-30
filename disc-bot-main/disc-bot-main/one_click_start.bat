@echo off
title Discord Wagering Bot
color 0B

cd /d "%~dp0"

:MENU
cls
echo.
echo  ==============================================================
echo   DISCORD WAGERING BOT - PRODUCTION SHELL
echo  ==============================================================
echo.
echo   1 = START BOT
echo   2 = RUN DIAGNOSTICS
echo   3 = UPDATE FROM GITHUB
echo   4 = EDIT .env
echo   5 = REINSTALL DEPENDENCIES
echo   6 = EXIT
echo.
choice /c 123456 /n /m "Press a key [1-6]: "

if errorlevel 6 goto EXIT_SCRIPT
if errorlevel 5 goto CLEAN
if errorlevel 4 goto ENV_EDIT
if errorlevel 3 goto UPDATE
if errorlevel 2 goto DIAGNOSTICS
if errorlevel 1 goto START_BOT

goto MENU

:START_BOT
cls
echo.
echo  Checking prerequisites...
echo.
if not exist .env (
    echo  [ERROR] .env file is missing!
    echo  Please create a .env file with your DISCORD_TOKEN.
    pause
    goto MENU
)
if not exist node_modules (
    echo  [INFO] Installing dependencies...
    call npm install
)
echo.
echo  ==============================================================
echo   BOT IS NOW RUNNING - Close this window to stop.
echo  ==============================================================
echo.
:LOOP
node src/index.js
echo.
echo  [!] Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto LOOP

:DIAGNOSTICS
cls
node diagnose.js
pause
goto MENU

:UPDATE
cls
echo  Updating from GitHub...
call git fetch --all
call git reset --hard origin/main
echo  Done!
pause
goto MENU

:ENV_EDIT
start notepad .env
goto MENU

:CLEAN
cls
echo  Reinstalling dependencies...
if exist node_modules rmdir /s /q node_modules
call npm install
echo  Done!
pause
goto MENU

:EXIT_SCRIPT
exit
