@echo off
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run-operational.ps1" -Mode Activity
exit /b %errorlevel%
