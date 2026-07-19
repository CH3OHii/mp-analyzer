#!/usr/bin/env bash
# Generates "MP Analyzer.app" — a double-clickable launcher that:
#   1. checks the one-time certificate exists (clear dialog if not),
#   2. re-sideloads the manifest (idempotent — ribbon button can't go missing),
#   3. starts the local server with the ABSOLUTE node path baked in
#      (AppleScript apps don't inherit your shell PATH — nvm/homebrew installs
#      are invisible to them otherwise),
#   4. verifies the server actually came up before claiming success.
# Rerun after moving the project folder OR after changing your Node install.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$DIR/MP Analyzer.app"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
TMP_SCRIPT="$(mktemp /tmp/mp-launcher-XXXXXX).applescript"

cat > "$TMP_SCRIPT" <<EOF
set certsOk to do shell script "test -f \"\$HOME/.office-addin-dev-certs/localhost.crt\" && echo yes || echo no"
if certsOk is "no" then
	display dialog "One-time setup still needed.\n\nOpen Terminal and run:\n\ncd \"$DIR\" && npm run certs\n\n(macOS will ask for your password to trust the local certificate.)\n\nThen double-click MP Analyzer again." buttons {"OK"} default button 1 with title "MP Analyzer"
	return
end if
do shell script "mkdir -p \"\$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef\" && cp " & quoted form of "$DIR/manifest.xml" & " \"\$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef/mp-analyzer-manifest.xml\""
do shell script "export PATH=" & quoted form of "$NODE_DIR" & ":\$PATH; cd " & quoted form of "$DIR" & " && (nohup node scripts/serve.mjs > /tmp/mp-analyzer-server.log 2>&1 &) ; sleep 1"
set serverUp to do shell script "lsof -i :3000 >/dev/null 2>&1 && echo yes || echo no"
tell application "Microsoft Excel" to activate
if serverUp is "yes" then
	display notification "Server running on https://localhost:3000" with title "MP Analyzer"
else
	display dialog "Server failed to start.\n\nSee /tmp/mp-analyzer-server.log for the reason." buttons {"OK"} with title "MP Analyzer"
end if
EOF

rm -rf "$APP"
osacompile -o "$APP" "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

echo "Created: $APP  (node: $NODE_BIN)"
echo "Double-click it to start everything (server + Excel)."
echo "Optional: drag it into the Dock, or add it in System Settings → General →"
echo "Login Items to have the server start automatically at login."
