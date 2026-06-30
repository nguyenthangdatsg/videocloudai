Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Run the batch file in a visible window so errors are not hidden
' The batch file handles: cd /d, node check, node_modules check, port check
WshShell.Run """" & strPath & "\start-server.bat""", 1, False
