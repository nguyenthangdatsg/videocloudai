Set WshShell = CreateObject("WScript.Shell")

' Run the batch file in a visible window so errors are not hidden
' The batch file handles: cd /d, node check, node_modules check, port check
WshShell.Run """D:\AI\videocloudai\start-server.bat""", 1, False
