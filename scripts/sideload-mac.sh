#!/usr/bin/env bash
# Sideload the add-in into desktop Excel on macOS by copying the manifest
# into Excel's "wef" folder. Rerun after any manifest.xml change.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEF="$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef"
mkdir -p "$WEF"
cp "$DIR/manifest.xml" "$WEF/mp-analyzer-manifest.xml"
echo "Manifest copied to: $WEF/mp-analyzer-manifest.xml"
echo "Now FULLY quit Excel (Cmd+Q) and reopen it."
echo "The 'MP Analyzer' button appears at the right end of the Home ribbon."
