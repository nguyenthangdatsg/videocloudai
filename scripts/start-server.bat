@echo off
:: VideoCloudAI - Auto-start server
:: Run this directly, or use install-startup.bat to auto-start on boot

:: Resolve project root (parent of scripts/)
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
cd /d "%PROJECT_DIR%"

:: Ensure logs directory exists
if not exist "logs" mkdir logs

:: Wait for system to be ready
timeout /t 5 /nobreak >nul

:: Start server in minimized window
start "VideoCloudAI Server" /min cmd /c "npm run dev --workspace=apps/server 2>&1 >> logs\server.log"
