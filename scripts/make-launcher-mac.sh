#!/usr/bin/env bash
# Generates "MP Analyzer.app" — a double-clickable launcher that starts the
# local server (if not already running) and brings Excel to the front.
# Rerun this script if you ever move the project folder (the app embeds the path).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$DIR/MP Analyzer.app"
TMP_SCRIPT="$(mktemp /tmp/mp-launcher-XXXXXX).applescript"

cat > "$TMP_SCRIPT" <<EOF
-- re-sideload every launch (idempotent file copy) so the ribbon button can never
-- be missing because the one-time registration was skipped
do shell script "mkdir -p \"\$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef\" && cp " & quoted form of "$DIR/manifest.xml" & " \"\$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef/mp-analyzer-manifest.xml\""
do shell script "cd " & quoted form of "$DIR" & " && (nohup node scripts/serve.mjs > /tmp/mp-analyzer-server.log 2>&1 &) ; sleep 1"
tell application "Microsoft Excel" to activate
display notification "Server running on https://localhost:3000" with title "MP Analyzer"
EOF

rm -rf "$APP"
osacompile -o "$APP" "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

echo "Created: $APP"
echo "Double-click it to start everything (server + Excel)."
echo "Optional: drag it into the Dock, or add it in System Settings → General →"
echo "Login Items to have the server start automatically at login."
