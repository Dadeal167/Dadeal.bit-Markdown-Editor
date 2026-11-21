@echo off
setlocal
pushd "%~dp0.." || exit /b 1

if not exist "desktop\node_modules\electron\install.js" (
  call npm --prefix desktop ci --no-audit --no-fund
  if errorlevel 1 goto failed
)
if not exist "desktop\node_modules\electron\dist\electron.exe" (
  node "desktop\node_modules\electron\install.js"
  if errorlevel 1 goto failed
)

start "" "%CD%\desktop\node_modules\electron\dist\electron.exe" "%CD%\desktop"
popd
exit /b 0

:failed
echo Dadealbit Desktop could not start. Check the error above and try again.
popd
pause
exit /b 1
