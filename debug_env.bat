@echo off
title Debug Bot Environment
echo ==========================================
echo           DEBUG DIAGNOSTIC TOOL
echo ==========================================
echo.
echo Current Directory: %CD%
echo.

echo [1] Checking Node.js...
node --version
if %errorlevel% neq 0 echo Node.js NOT found in PATH.
echo.

echo [2] Checking NPM...
call npm --version
if %errorlevel% neq 0 echo NPM NOT found in PATH.
echo.

echo [3] Checking Environment Files...
if exist .env (echo [OK] .env found) else (echo [FAIL] .env MISSING)
if exist config.json (echo [OK] config.json found) else (echo [FAIL] config.json MISSING)
if exist node_modules (echo [OK] node_modules found) else (echo [FAIL] node_modules MISSING)
echo.

echo [4] Checking Syntax of Batch Files...
if exist install.bat (echo [OK] install.bat exists) else (echo [FAIL] install.bat MISSING)
if exist start_bot.bat (echo [OK] start_bot.bat exists) else (echo [FAIL] start_bot.bat MISSING)
echo.

echo ==========================================
echo Diagnostic complete. Take a screenshot!
echo ==========================================
pause
