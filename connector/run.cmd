@echo off
cd /d "%~dp0"
call npm run sync >> "%~dp0runtime\scheduled-sync.log" 2>&1
