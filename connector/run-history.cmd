@echo off
cd /d "%~dp0"
node lead-opportunity-sync.js >> "%~dp0runtime\historical-sync.log" 2>&1
if errorlevel 1 exit /b 1
node calls-sync.js >> "%~dp0runtime\historical-sync.log" 2>&1
if errorlevel 1 exit /b 1
node tickets-sync.js >> "%~dp0runtime\historical-sync.log" 2>&1
