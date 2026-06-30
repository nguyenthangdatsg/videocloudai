@echo off
title VideoCloudAI Server
color 0A

echo ============================================
echo   VideoCloudAI - Starting Server...
echo ============================================
echo.

:: Set working directory to the project root
cd /d "%~dp0"
if errorlevel 1 goto NoProjectDir

:: Verify node is available
where node >nul 2>&1
if errorlevel 1 goto NoNode

:: Check Node.js version is >= 20
node -e "const [major] = process.versions.node.split('.'); if (parseInt(major) < 20) { process.exit(1); }" >nul 2>&1
if errorlevel 1 goto OldNode

:: Verify npm is available
where npm >nul 2>&1
if errorlevel 1 goto NoNpm

echo [OK] Node.js found:
node -v

:: Run initial environment setup checks (creates dirs, checks FFmpeg/Python)
echo.
echo [SETUP] Checking directory structure and system dependencies...
node scripts/setup.js

:: Verify node_modules exist
if not exist "node_modules" goto RunNpmInstall

:CheckPorts
:: Check if ports are already in use
netstat -ano | findstr ":3002 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto Port3002InUse

:CheckPort5174
netstat -ano | findstr ":5174 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto Port5174InUse

:StartServer
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
exit /b 0


:NoProjectDir
echo [ERROR] Cannot find project directory "%~dp0"
pause
exit /b 1

:NoNode
echo.
echo ============================================================
echo [ERROR] Node.js was not found on this computer.
echo.
echo VideoCloudAI requires Node.js (version 20 or higher).
echo Please download and install it from: https://nodejs.org/
echo ============================================================
echo.
pause
exit /b 1

:OldNode
echo.
echo ============================================================
echo [ERROR] Node.js version 20 or higher is required.
echo.
echo Your current Node.js version is:
node -v
echo Please download and install a newer LTS version (v20+) from:
echo https://nodejs.org/
echo ============================================================
echo.
pause
exit /b 1

:NoNpm
echo.
echo ============================================================
echo [ERROR] npm (Node Package Manager) was not found.
echo.
echo Make sure Node.js is installed correctly (npm is usually bundled
echo with Node.js). If you just installed it, please restart your 
echo computer or command prompt window and try again.
echo ============================================================
echo.
pause
exit /b 1

:RunNpmInstall
echo.
echo [WARN] node_modules missing. Running npm install...
npm install
if errorlevel 1 goto NpmInstallFailed
goto CheckPorts

:NpmInstallFailed
echo.
echo ============================================================
echo [ERROR] npm install failed!
echo ============================================================
echo.
echo This usually happens due to one of the following reasons:
echo.
echo 1. Missing C++ Compiler / Build Tools (For 'better-sqlite3')
echo    'better-sqlite3' compiles native code and requires C++ build tools.
echo    How to fix:
echo    - Open PowerShell as Administrator and run:
echo        npm install --global --production windows-build-tools
echo    - OR install Visual Studio Build Tools (C++ Build Tools workload):
echo        https://visualstudio.microsoft.com/visual-cpp-build-tools/
echo    - OR use winget:
echo        winget install Microsoft.VisualStudio.2022.BuildTools
echo.
echo 2. Python is not installed or not in PATH
echo    node-gyp (the compiler tool) requires Python to run.
echo    How to fix:
echo    - Install Python from: https://www.python.org/downloads/
echo    - Make sure to check "Add Python to PATH" during installation.
echo.
echo 3. Network or Firewall issues
echo    How to fix:
echo    - Check your internet connection.
echo    - Try running: npm cache clean --force
echo.
echo 4. Node.js Version compatibility
echo    You are using Node.js:
node -v
echo    Make sure it's a stable LTS version (like v20 or v22).
echo.
echo ------------------------------------------------------------
echo TIP: To see the detailed error logs, open Command Prompt,
echo navigate to this folder, and run "npm install" manually.
echo ------------------------------------------------------------
echo.
pause
exit /b 1

:Port3002InUse
echo [WARN] Port 3002 (backend) is already in use. Server may already be running.
echo Press any key to continue anyway, or close this window to cancel.
pause
goto CheckPort5174

:Port5174InUse
echo [WARN] Port 5174 (frontend) is already in use.
echo Press any key to continue anyway, or close this window to cancel.
pause
goto StartServer
