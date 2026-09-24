@echo off
cd /d "%~dp0"
for /f %%D in ('powershell -NoProfile -Command "(Get-Date).DayOfWeek"') do set DOW=%%D
if /I "%DOW%"=="Friday" (
  echo [%date% %time%] Friday - Historical activity sync skipped.>> "%~dp0runtimehistorical-sync.log"
  exit /b 0
)
node lead-opportunity-sync.js >> "%~dp0runtimehistorical-sync.log" 2>&1
if errorlevel 1 exit /b 1
node calls-sync.js >> "%~dp0runtimehistorical-sync.log" 2>&1
if errorlevel 1 exit /b 1
node tickets-sync.js >> "%~dp0runtimehistorical-sync.log" 2>&1
