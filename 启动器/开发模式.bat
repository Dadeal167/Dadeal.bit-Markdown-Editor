@echo off
title Dadealbit Markdown Editor - Dev Server
rem --- this .bat lives in the launcher subfolder; the repo root is one level up ---
cd /d "%~dp0.."

echo.
echo   ==========================================
echo    Dev server mode
echo    KEEP THIS WINDOW OPEN while you use it.
echo    Closing this window stops the server.
echo   ==========================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 goto :nopnpm

if not exist "node_modules" (
  echo   First run: installing dependencies, this needs internet...
  call pnpm install
  if errorlevel 1 goto :installfail
)

echo   Starting server, opening browser in a few seconds:
echo       http://127.0.0.1:5173
echo.
start "" "http://127.0.0.1:5173"
call pnpm dev

echo.
echo   Server stopped. Press any key to close this window.
pause >nul
exit /b 0

:nopnpm
echo   [x] pnpm not found.
echo       Install Node.js first, then run:  npm i -g pnpm
echo.
pause
exit /b 1

:installfail
echo.
echo   [x] "pnpm install" failed. Check your network and try again.
echo.
pause
exit /b 1
