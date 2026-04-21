#!/usr/bin/env bash
#
# Uninstall the Synthesis Console macOS LaunchAgent.

set -euo pipefail

LABEL="org.synthesisengineering.console"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: This script is for macOS." >&2
  exit 1
fi

UID_NUM="$(id -u)"

if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  echo "Unloaded ${LABEL}."
else
  echo "Not currently loaded."
fi

if [[ -f "${PLIST_PATH}" ]]; then
  rm "${PLIST_PATH}"
  echo "Removed ${PLIST_PATH}."
else
  echo "No plist at ${PLIST_PATH}."
fi

echo ""
echo "Synthesis Console will no longer start on login."
echo "Logs remain at ~/Library/Logs/synthesis-console/ (delete manually if desired)."
