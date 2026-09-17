@echo off
title Dadealbit Zhihu Draft Assistant
rem --- this .bat lives in the launcher subfolder; the repo root is one level up ---
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "node_modules" goto :nodeps
if not exist "scripts\zhihu-assistant.mjs" goto :nofile

echo.
echo   Starting the Zhihu draft assistant...
echo   Keep this window open while uploading.
echo   The token is printed below and copied to your clipboard.
echo.
node scripts\zhihu-assistant.mjs
echo.
echo   Assistant stopped. Press any key to close.
pause >nul
exit /b 0

:nonode
echo   [x] Node.js not found. Install it first from https://nodejs.org
echo.
pause
exit /b 1

:nodeps
echo   [x] Dependencies missing. Run "pnpm install" in this folder first.
echo.
pause
exit /b 1

:nofile
echo   [x] scripts\zhihu-assistant.mjs not found.
echo.
pause
exit /b 1
