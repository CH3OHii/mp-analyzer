' MP Analyzer launcher (Windows) — double-click to start everything.
'
' First run on a machine it also bootstraps itself (a console window appears so
' you can see progress; later runs are silent):
'   1. npm install                        (if the dependency tree is missing/incomplete)
'   2. certificate install                (Windows shows a "trust certificate?" dialog — click Yes)
'   3. add-in registration in the registry (so the ribbon button appears)
'   4. first build of dist/               (~30s; gitignored, so a fresh clone lacks it)
' Then every run: starts the local server hidden and opens Excel.
'
' Closing a bootstrap console window mid-step cancels that step. Re-running the
' launcher picks up where it left off — no cleanup needed.
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

If Not DepsInstalled() Then
  ret = RunInProject("npm install", "npm install")
  If ret <> 0 Then WScript.Quit ret
End If

If Not fso.FileExists(marker) Then
  ' Run the LOCALLY installed tools via their npm scripts, never `npx`. npx would
  ' re-download each tool into its own %LOCALAPPDATA%\npm-cache\_npx exec-cache and
  ' then try to delete it, which on Windows routinely fails with
  '   EPERM: operation not permitted, rmdir ...\_npx\...
  ' when real-time antivirus is holding a scan lock on the freshly-extracted files.
  ' `npm run` uses node_modules\.bin directly — no _npx dir is ever created, so there
  ' is nothing to hit that error on. The two steps are separate so a failure names
  ' exactly which one broke.
  ret = RunInProject("certificate install", "npm run certs")
  If ret <> 0 Then WScript.Quit ret
  ret = RunInProject("add-in registration", "npm run sideload:win")
  If ret <> 0 Then WScript.Quit ret
  fso.CreateTextFile(marker, True).Close
End If

' dist/ is gitignored, so a fresh clone has to build it once. serve.mjs would do
' that itself, but it runs HIDDEN — Excel opens 800ms later against a server still
' 30s from ready, and the task pane just fails to load with nothing to read. Build
' here instead: visible, blocking, and a broken build pauses with its own error.
If Not fso.FileExists(projectDir & "\dist\index.html") Then
  ret = RunInProject("first build", "npm run build")
  If ret <> 0 Then WScript.Quit ret
End If

sh.Run "cmd /c cd /d """ & projectDir & """ && node scripts\serve.mjs", 0, False
WScript.Sleep 800
sh.Run "cmd /c start excel", 0, False

' --------------------------------------------------------------------------------

' Runs a bootstrap step in the project folder in a visible console, and returns its
' REAL exit code. The window stays open on failure so the tool's own error is readable.
'
' This writes a small temp .bat file and runs THAT, rather than packing everything
' (cd, the step, an errorlevel check, echo, pause) onto one cmd.exe /c line with
' && and & mixed together. Two earlier one-liner attempts each caused a confusing
' false failure -- first `... || pause` always returning 0 because `pause` itself
' succeeds, then a delayed-expansion (!RC!) version that intermittently reported
' "failed with exit code 0", a contradiction that points at single-line command
' parsing/timing, not the step itself. A normal multi-line .bat with a plain
' `if errorlevel 1 (...)` check is the idiom every Windows batch tutorial uses for
' a reason: %errorlevel% inside that block is substituted once, when the `if` line
' is reached -- i.e. right after the preceding command set it -- with no timing
' games to get wrong. It is also just a file, so it can be opened and read if
' something still looks wrong.
Function RunInProject(label, cmdline)
  Dim batPath, bat, ret
  batPath = fso.GetSpecialFolder(2) & "\mp-analyzer-step.bat"  ' 2 = TemporaryFolder

  Set bat = fso.CreateTextFile(batPath, True)
  bat.WriteLine "@echo off"
  bat.WriteLine "cd /d """ & projectDir & """"
  ' `call` is mandatory: npm is npm.cmd, and one batch file invoking another
  ' WITHOUT `call` transfers control permanently instead of returning. Without it
  ' every line below (the errorlevel check, the message, the pause) is dead code —
  ' the window slams shut the instant npm exits and the user never sees the error.
  bat.WriteLine "call " & cmdline
  bat.WriteLine "if errorlevel 1 ("
  bat.WriteLine "  echo."
  bat.WriteLine "  echo [MP Analyzer] " & label & " failed with exit code %errorlevel%"
  bat.WriteLine "  pause"
  bat.WriteLine "  exit /b 1"
  bat.WriteLine ")"
  bat.WriteLine "exit /b 0"
  bat.Close

  ret = sh.Run("cmd /c """ & batPath & """", 1, True)
  If fso.FileExists(batPath) Then fso.DeleteFile batPath, True
  RunInProject = ret
End Function

Function NpmResolves()
  NpmResolves = (sh.Run("cmd /c where npm >nul 2>&1", 0, True) = 0)
End Function

' An `npm install` that was killed partway — closing its console window is enough —
' leaves node_modules BEHIND but incomplete, so the folder existing proves nothing.
' Checking the shims the bootstrap actually invokes is what distinguishes a finished
' install from an abandoned one; otherwise every later run skips the install, then
' dies on the first missing tool. npm install is idempotent, so re-running costs
' seconds when the tree is already complete.
Function DepsInstalled()
  Dim bin, needed, n
  bin = projectDir & "\node_modules\.bin\"
  needed = Array("office-addin-dev-certs.cmd", "office-addin-dev-settings.cmd", "vite.cmd", "tsc.cmd")
  DepsInstalled = False
  For Each n In needed
    If Not fso.FileExists(bin & n) Then Exit Function
  Next
  DepsInstalled = True
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
