#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/package.json" || ! -f "$ROOT/scripts/refresh-ai-model-catalog.js" ]]; then
  echo "Project root tidak valid: $ROOT" >&2; exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  NODE_PATH="$(command -v node || true)"
  [[ -n "$NODE_PATH" ]] || { echo "Node.js tidak ditemukan di PATH." >&2; exit 1; }
  exec sudo env OCHA_NODE_BIN="$NODE_PATH" OCHA_RUN_USER="${USER}" bash "$0"
fi

NODE_BIN="${OCHA_NODE_BIN:-$(command -v node || true)}"
[[ -x "$NODE_BIN" ]] || { echo "Node.js executable tidak valid: $NODE_BIN" >&2; exit 1; }
RUN_USER="${OCHA_RUN_USER:-${SUDO_USER:-root}}"
id "$RUN_USER" >/dev/null 2>&1 || { echo "User service tidak ditemukan: $RUN_USER" >&2; exit 1; }

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  SERVICE_FILE=/etc/systemd/system/ocha-ai-model-catalog.service
  TIMER_FILE=/etc/systemd/system/ocha-ai-model-catalog.timer
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Ocha Lidya autonomous AI model catalog refresh
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$ROOT
Environment=NODE_ENV=production
UMask=0077
ExecStart="$NODE_BIN" "$ROOT/scripts/refresh-ai-model-catalog.js"
Nice=10
EOF
  cat > "$TIMER_FILE" <<'EOF'
[Unit]
Description=Refresh Ocha Lidya AI model catalog every 24 hours

[Timer]
OnBootSec=2min
OnUnitActiveSec=24h
AccuracySec=1min
Persistent=true
Unit=ocha-ai-model-catalog.service

[Install]
WantedBy=timers.target
EOF
  chmod 0644 "$SERVICE_FILE" "$TIMER_FILE"
  systemctl daemon-reload
  systemctl enable --now ocha-ai-model-catalog.timer
  echo "Timer systemd aktif."
  systemctl --no-pager --full status ocha-ai-model-catalog.timer || true
  echo "Jadwal: 2 menit setelah boot, lalu setiap 24 jam. Tetap bekerja saat terminal dan bot berhenti, selama host hidup dan jaringan tersedia."
  exit 0
fi

if command -v crontab >/dev/null 2>&1; then
  LOG_DIR="$ROOT/logs"
  mkdir -p "$LOG_DIR"
  touch "$LOG_DIR/ai-model-catalog.log"
  chmod 0600 "$LOG_DIR/ai-model-catalog.log"
  CURRENT="$(crontab -u "$RUN_USER" -l 2>/dev/null || true)"
  FILTERED="$(printf '%s\\n' "$CURRENT" | grep -v 'scripts/refresh-ai-model-catalog.js' || true)"
  {
    printf '%s\\n' "$FILTERED"
    printf '@reboot sleep 120 && cd %q && %q scripts/refresh-ai-model-catalog.js >> %q 2>&1\\n' "$ROOT" "$NODE_BIN" "$LOG_DIR/ai-model-catalog.log"
    printf '17 3 * * * cd %q && %q scripts/refresh-ai-model-catalog.js >> %q 2>&1\\n' "$ROOT" "$NODE_BIN" "$LOG_DIR/ai-model-catalog.log"
  } | crontab -u "$RUN_USER" -
  echo "Cron aktif: saat boot + setiap hari pukul 03:17 waktu lokal. Untuk interval tepat 24 jam gunakan host systemd."
  exit 0
fi

echo "Tidak ditemukan systemd aktif maupun crontab. Jadwal persisten tidak dipasang." >&2
exit 1
