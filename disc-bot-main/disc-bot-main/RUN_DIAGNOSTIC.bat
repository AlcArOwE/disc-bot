@echo off
echo ============================================================
echo DISC-BOT DIAGNOSTIC
echo ============================================================
echo.
cd /d "%~dp0"
node diagnose.js
echo.
pause
