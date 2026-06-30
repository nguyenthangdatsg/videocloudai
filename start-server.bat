@echo off
title VideoCloudAI Server
color 0A

echo ============================================
echo   VideoCloudAI - Starting Server...
echo ============================================
echo.

:: Set working directory to the project root
cd /d "%~dp0"
if errorlevel 1 (
    echo [ERROR] Cannot find project directory "%~dp0"
    pause
    exit /b 1
)

:: Verify node is available
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo Make sure Node.js is installed and restart your computer.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node -v

:: Verify node_modules exist
if not exist "node_modules" (
    echo [WARN] node_modules missing. Running npm install...
    npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: Check if ports are already in use
netstat -ano | findstr ":3002 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3002 (backend) is already in use. Server may already be running.
    echo Press any key to continue anyway, or close this window to cancel.
    pause
)
netstat -ano | findstr ":5174 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 5174 (frontend) is already in use.
    echo Press any key to continue anyway, or close this window to cancel.
    pause
)

echo.
echo [START] Running npm run dev...
echo   Frontend: http://localhost:5174
echo   Backend:  http://localhost:3002/api
echo ============================================
echo.

:: Start the dev server
npm run dev

:: If we get here, the server stopped
echo.
echo ============================================
echo   Server has stopped.
echo ============================================
echo Press any key to exit...
pause
