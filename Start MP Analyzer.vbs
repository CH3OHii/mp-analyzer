' MP Analyzer launcher (Windows) — double-click to start everything.
'
' First run on a machine it also bootstraps itself (a console window appears so
' you can see progress; later runs are silent):
'   1. npm install                        (if node_modules is missing)
'   2. certificate install                (Windows shows a "trust certificate?" dialog — click Yes)
'   3. add-in registration in the registry (so the ribbon button appears)
' Then every run: starts the local server hidden and opens Excel.
'
' Requires Node.js (nodejs.org) to be installed. If the ribbon button is missing
' after first run, fully EXIT Excel (right-click its taskbar icon → close all)
' and reopen — Excel only reads add-in registrations at startup.
'
' Optional auto-start at login: Win+R → shell:startup → put a SHORTCUT to this file there.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
marker = projectDir & "\.sideloaded"

If Not fso.FolderExists(projectDir & "\node_modules") Then
  ret = sh.Run("cmd /c cd /d """ & projectDir & """ && npm install || pause", 1, True)
  If ret <> 0 Then WScript.Quit ret
End If

If Not fso.FileExists(marker) Then
  ret = sh.Run("cmd /c cd /d """ & projectDir & """ && npx office-addin-dev-certs install && npx office-addin-dev-settings sideload manifest.xml || pause", 1, True)
  If ret = 0 Then
    fso.CreateTextFile(marker, True).Close
  Else
    WScript.Quit ret
  End If
End If

sh.Run "cmd /c cd /d """ & projectDir & """ && node scripts\serve.mjs", 0, False
WScript.Sleep 800
sh.Run "cmd /c start excel", 0, False
