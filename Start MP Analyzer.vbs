' MP Analyzer launcher (Windows) — double-click to start the local server
' hidden in the background and open Excel. No terminal window appears.
'
' Optional auto-start at login: press Win+R, type  shell:startup  and place a
' SHORTCUT to this file in the folder that opens.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c cd /d """ & projectDir & """ && node scripts\serve.mjs", 0, False
WScript.Sleep 800
sh.Run "cmd /c start excel", 0, False
