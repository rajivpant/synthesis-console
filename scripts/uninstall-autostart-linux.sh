#!/usr/bin/env bash
#
# Uninstall the Synthesis Console systemd user unit.

set -euo pipefail

UNIT_NAME="synthesis-console.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="${UNIT_DIR}/${UNIT_NAME}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Error: This script is for Linux." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Error: systemctl not found." >&2
  exit 1
fi

if systemctl --user is-enabled "${UNIT_NAME}" >/dev/null 2>&1; then
  systemctl --user disable --now "${UNIT_NAME}" || true
  echo "Disabled and stopped ${UNIT_NAME}."
else
  systemctl --user stop "${UNIT_NAME}" 2>/dev/null || true
  echo "${UNIT_NAME} was not enabled."
fi

if [[ -f "${UNIT_PATH}" ]]; then
  rm "${UNIT_PATH}"
  systemctl --user daemon-reload
  echo "Removed ${UNIT_PATH}."
else
  echo "No unit file at ${UNIT_PATH}."
fi

echo ""
echo "Synthesis Console will no longer start on login."
