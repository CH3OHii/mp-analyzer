' MP Analyzer launcher (Windows) — double-click to start everything.
'
' First run on a machine it also bootstraps itself (a console window appears so
' you can see progress; later runs are silent):
'   1. npm install                        (if node_modules is missing)
'   2. certificate install                (Windows shows a "trust certificate?" dialog — click Yes)
'   3. add-in registration in the registry (so the ribbon button appears)
' Then every run: starts the local server hidden and opens Excel.
'
' Requires Node.js 18+ (nodejs.org). Node does NOT need to be on your PATH: a process
' launched from Explorer inherits the PATH snapshot Explorer took when it started, so a
' freshly installed Node is invisible until you sign out and back in. This script
' therefore also looks in the standard install locations and puts the one it finds on
' the PATH itself — the same lesson scripts/make-launcher-mac.sh learned about
' AppleScript apps not inheriting a shell PATH.
'
' Dialog text here is deliberately plain ASCII: wscript.exe reads .vbs files using the
' system ANSI codepage, so non-ASCII characters in a MsgBox render as mojibake on a
' non-Western Windows. (Comments are exempt — they are never displayed.)
'
' If the ribbon button is missing after first run, fully EXIT Excel (right-click its
' taskbar icon → close all) and reopen — Excel only reads add-in registrations at startup.
'
' Optional auto-start at login: Win+R → shell:startup → put a SHORTCUT to this file there.

Option Explicit

Dim fso, sh, projectDir, marker, ret, nodeDir, env

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
marker = projectDir & "\.sideloaded"

' --- Node.js has to be reachable before any bootstrap step runs -----------------
If Not NpmResolves() Then
  nodeDir = FindNodeDir()
  If nodeDir = "" Then
    ReportNodeMissing
    WScript.Quit 1
  End If
  ' Child processes started with sh.Run inherit this process's environment, so
  ' prepending here makes npm / npx / node resolve for every step below.
  Set env = sh.Environment("Process")
  env("PATH") = nodeDir & ";" & env("PATH")
End If

If Not fso.FolderExists(projectDir & "\node_modules") Then
  ret = RunInProject("npm install", "npm install")
  If ret <> 0 Then WScript.Quit ret
End If

If Not fso.FileExists(marker) Then
  ret = RunInProject("certificate + add-in registration", _
        "npx office-addin-dev-certs install && npx office-addin-dev-settings sideload manifest.xml")
  If ret <> 0 Then WScript.Quit ret
  fso.CreateTextFile(marker, True).Close
End If

sh.Run "cmd /c cd /d """ & projectDir & """ && node scripts\serve.mjs", 0, False
WScript.Sleep 800
sh.Run "cmd /c start excel", 0, False

' --------------------------------------------------------------------------------

' Runs a bootstrap step in the project folder in a visible console, and returns its
' REAL exit code. The window stays open on failure so the tool's own error is readable.
'
' The previous form -- cmd /c <step> || pause -- always returned 0, because `pause`
' itself succeeds. A failed step therefore looked like success, and the script went on
' to write the .sideloaded marker, which permanently skips certificate + registration
' on every later run. Hence: save errorlevel first, pause second, exit with the saved
' value (delayed expansion via /v:on, since %errorlevel% would expand at parse time).
Function RunInProject(label, cmdline)
  Dim c
  c = "cmd /v:on /c cd /d """ & projectDir & """ && " & cmdline & _
      " & set RC=!errorlevel!" & _
      " & if not ""!RC!""==""0"" (echo.&echo [MP Analyzer] " & label & " failed with exit code !RC!&pause)" & _
      " & exit /b !RC!"
  RunInProject = sh.Run(c, 1, True)
End Function

Function NpmResolves()
  NpmResolves = (sh.Run("cmd /c where npm >nul 2>&1", 0, True) = 0)
End Function

' Standard install locations, most authoritative first. Covers the official MSI
' (which records its path in the registry), per-machine and per-user installs, and
' the common version managers.
Function FindNodeDir()
  Dim dirs, d, regPath
  FindNodeDir = ""

  On Error Resume Next
  regPath = sh.RegRead("HKLM\SOFTWARE\Node.js\InstallPath")
  On Error GoTo 0
  If HasNpm(regPath) Then
    FindNodeDir = TrimTrailingSlash(regPath)
    Exit Function
  End If

  dirs = Array( _
    "%ProgramFiles%\nodejs", _
    "%ProgramFiles(x86)%\nodejs", _
    "%LOCALAPPDATA%\Programs\nodejs", _
    "%NVM_SYMLINK%", _
    "%LOCALAPPDATA%\Volta\bin", _
    "%USERPROFILE%\scoop\shims", _
    "%ProgramData%\chocolatey\bin")

  For Each d In dirs
    d = sh.ExpandEnvironmentStrings(d)
    If HasNpm(d) Then
      FindNodeDir = TrimTrailingSlash(d)
      Exit Function
    End If
  Next
End Function

Function HasNpm(candidate)
  Dim d
  HasNpm = False
  If candidate = "" Then Exit Function
  ' ExpandEnvironmentStrings leaves %FOO% intact when FOO is not defined.
  If InStr(candidate, "%") > 0 Then Exit Function
  d = TrimTrailingSlash(candidate)
  If fso.FileExists(d & "\npm.cmd") Or fso.FileExists(d & "\npm.exe") Then HasNpm = True
End Function

Function TrimTrailingSlash(d)
  TrimTrailingSlash = d
  Do While Len(TrimTrailingSlash) > 3 And Right(TrimTrailingSlash, 1) = "\"
    TrimTrailingSlash = Left(TrimTrailingSlash, Len(TrimTrailingSlash) - 1)
  Loop
End Function

Sub ReportNodeMissing()
  Dim msg
  msg = "Node.js was not found, so MP Analyzer cannot start." & vbCrLf & vbCrLf & _
        "1. Install Node.js LTS from https://nodejs.org (accept the defaults)." & vbCrLf & _
        "2. Sign out of Windows and back in, so the PATH refreshes." & vbCrLf & _
        "3. Double-click this launcher again." & vbCrLf & vbCrLf & _
        "If Node.js is already installed, step 2 is almost certainly the fix: a" & vbCrLf & _
        "program started from Explorer keeps the PATH that Explorer had at login." & vbCrLf & vbCrLf & _
        "Open the Node.js download page now?"
  If MsgBox(msg, vbYesNo + vbExclamation, "MP Analyzer") = vbYes Then
    sh.Run "https://nodejs.org/en/download", 1, False
  End If
End Sub
