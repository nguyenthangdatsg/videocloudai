@echo off
:: Creates a Windows Startup shortcut so VideoCloudAI server starts on boot.
:: Run this once. To remove, delete the shortcut from shell:startup.

set "SCRIPT_DIR=%~dp0"
set "BAT_PATH=%SCRIPT_DIR%start-server.bat"
set "PROJECT_DIR=%SCRIPT_DIR%.."

powershell -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup\VideoCloudAI.lnk'));" ^
  "$lnk.TargetPath = '%BAT_PATH%';" ^
  "$lnk.WorkingDirectory = '%PROJECT_DIR%';" ^
  "$lnk.WindowStyle = 7;" ^
  "$lnk.Description = 'Auto-start VideoCloudAI server';" ^
  "$lnk.Save();" ^
  "Write-Host 'Startup shortcut installed successfully.'"

pause
