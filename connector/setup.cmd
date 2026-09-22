@echo off
setlocal
cd /d "%~dp0"

if not exist ".env.local" (
  copy ".env.example" ".env.local" >nul
  notepad ".env.local"
  echo.
  echo Save .env.local, close Notepad, then press any key to continue.
  pause >nul
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm was not found on this computer.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo.
echo Running first CRM sync...
call npm run sync

echo.
echo Setup finished.
pause
