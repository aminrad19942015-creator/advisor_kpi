@echo off
cd /d "%~dp0"
for /f %%D in ('powershell -NoProfile -Command "(Get-Date).DayOfWeek"') do set DOW=%%D
if /I "%DOW%"=="Friday" (
  echo [%date% %time%] Friday - Open Leads sync skipped.>> "%~dp0runtimescheduled-sync.log"
  exit /b 0
)
call npm run sync >> "%~dp0runtimescheduled-sync.log" 2>&1
