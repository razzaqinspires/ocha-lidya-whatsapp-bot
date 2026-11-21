#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${EUID}" -ne 0 ]]; then exec sudo bash "$0"; fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now ocha-ai-model-catalog.timer 2>/dev/null || true
  rm -f /etc/systemd/system/ocha-ai-model-catalog.timer /etc/systemd/system/ocha-ai-model-catalog.service
  systemctl daemon-reload || true
fi
if command -v crontab >/dev/null 2>&1; then
  USER_NAME="${SUDO_USER:-root}"
  CURRENT="$(crontab -u "$USER_NAME" -l 2>/dev/null || true)"
  printf '%s\\n' "$CURRENT" | grep -v 'scripts/refresh-ai-model-catalog.js' | crontab -u "$USER_NAME" - || true
fi
echo "Scheduler AI model catalog dihapus. File katalog tidak ikut dihapus."
