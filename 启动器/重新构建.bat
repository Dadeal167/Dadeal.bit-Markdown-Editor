@echo off
title Dadealbit Markdown Editor - Rebuild
rem --- this .bat lives in the launcher subfolder; the repo root is one level up ---
cd /d "%~dp0.."

echo.
echo   Rebuilding the single-file editor...
echo   (source: src\  -^>  dist\index.html + Dadealbit HTML file in this folder)
echo.

where pnpm >nul 2>nul
if errorlevel 1 goto :nopnpm

if not exist "node_modules" (
  echo   First run: installing dependencies, this needs internet...
  call pnpm install
  if errorlevel 1 goto :installfail
)

call pnpm build
if errorlevel 1 goto :buildfail

echo.
echo   Done. Double-click either HTML file in this folder to use it.
echo.
pause
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

:buildfail
echo.
echo   [x] Build failed. See the errors above.
echo.
pause
exit /b 1
