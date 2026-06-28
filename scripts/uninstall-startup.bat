@echo off
:: Removes the VideoCloudAI auto-start shortcut from Windows Startup.

del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VideoCloudAI.lnk" 2>nul
if %errorlevel%==0 (
    echo Startup shortcut removed successfully.
) else (
    echo No startup shortcut found.
)
pause
