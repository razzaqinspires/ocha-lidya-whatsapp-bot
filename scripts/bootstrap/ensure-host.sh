#!/usr/bin/env bash
# Idempotent Nexora host prerequisite manager.
# Installs only missing host packages/images. It never starts per-job daemons.
set -Eeuo pipefail

RUNTIME="${1:-docker}"
PYTHON_IMAGE="${2:-python:3.12-alpine}"
NODE_IMAGE="${3:-node:22-alpine}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_CONFIG="${PROJECT_ROOT}/config/runtime.json"
read_runtime_setting() {
  node -e 'const fs=require("node:fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const [section,key]=process.argv[2].split(".");const v=c?.[section]?.[key];process.stdout.write(String(v ?? ""));' "$RUNTIME_CONFIG" "$1"
}
CLOUDFLARED_BIN="${4:-$(read_runtime_setting rentalApi.cloudflaredBin)}"
DRY_RUN="$(read_runtime_setting tooling.bootstrapDryRun)"
if [[ "${NEXORA_BOOTSTRAP_DRY_RUN:-$DRY_RUN}" == "1" || "${NEXORA_BOOTSTRAP_DRY_RUN:-$DRY_RUN}" == "true" ]]; then DRY_RUN=1; else DRY_RUN=0; fi

log() { printf '[NEXORA BOOTSTRAP] %s\n' "$*"; }
warn() { printf '[NEXORA BOOTSTRAP] WARNING: %s\n' "$*" >&2; }
fail() { warn "$*"; exit 1; }

[[ "$RUNTIME" == "docker" || "$RUNTIME" == "podman" || "$RUNTIME" == "auto" ]] || fail "Runtime tidak didukung: $RUNTIME (pilih auto, docker, atau podman)."
for image in "$PYTHON_IMAGE" "$NODE_IMAGE"; do
  [[ "$image" =~ ^[A-Za-z0-9._/:@-]+$ ]] || fail "Nama image tidak valid: $image"
done
[[ "$CLOUDFLARED_BIN" != *" "* ]] || fail "cloudflaredBin tidak boleh berisi argumen; gunakan path executable saja."

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY RUN aktif; tidak ada perubahan host yang dilakukan."
  log "DRY RUN runtime=${RUNTIME} images=${PYTHON_IMAGE},${NODE_IMAGE} cloudflared=${CLOUDFLARED_BIN}. Ini bukan konfirmasi bahwa dependensi sudah terpasang."
  log "DRY RUN: pemeriksaan daemon, image pull, package manager, service, dan tunnel dilewati agar preflight tidak menunggu host eksternal."
  exit 0
fi

ADMIN=()
ROOT_READY=1
if (( EUID != 0 )); then
  if command -v doas >/dev/null 2>&1 && doas -n true >/dev/null 2>&1; then
    ADMIN=(doas -n)
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    ADMIN=(sudo -n)
  else
    ROOT_READY=0
    warn "Proses berjalan sebagai UID $(id -u) tanpa hak admin non-interaktif. Paket host/service sistem tidak akan diubah; runtime rootless yang tersedia tetap akan dicoba."
  fi
fi

root_run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[NEXORA BOOTSTRAP] DRY RUN admin command:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  if (( EUID == 0 )); then
    "$@"
  elif (( ROOT_READY == 1 )); then
    "${ADMIN[@]}" "$@"
  else
    warn "Tidak ada hak admin untuk menjalankan: $*"
    return 1
  fi
}

OS_ID="unknown"
OS_ID_LIKE=""
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_ID_LIKE="${ID_LIKE:-}"
fi

PKG_FAMILY="unknown"
APT_UPDATED=0
if command -v apt-get >/dev/null 2>&1; then PKG_FAMILY="apt"
elif command -v dnf >/dev/null 2>&1; then PKG_FAMILY="dnf"
elif command -v yum >/dev/null 2>&1; then PKG_FAMILY="yum"
elif command -v apk >/dev/null 2>&1; then PKG_FAMILY="apk"
fi

install_packages() {
  local packages=("$@")
  (( ${#packages[@]} )) || return 0
  if (( ROOT_READY == 0 )); then
    warn "Butuh hak root untuk memasang paket: ${packages[*]}"
    return 1
  fi
  case "$PKG_FAMILY" in
    apt)
      if (( APT_UPDATED == 0 )); then root_run apt-get update; APT_UPDATED=1; fi
      root_run env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
      ;;
    dnf) root_run dnf install -y "${packages[@]}" ;;
    yum) root_run yum install -y "${packages[@]}" ;;
    apk) root_run apk add --no-cache "${packages[@]}" ;;
    *) warn "Package manager tidak didukung untuk instalasi otomatis."; return 1 ;;
  esac
}

ensure_cli_tools() {
  local missing=() packages=()
  command -v git >/dev/null 2>&1 || missing+=(git)
  command -v python3 >/dev/null 2>&1 || missing+=(python3)
  command -v go >/dev/null 2>&1 || missing+=(go)
  if (( ${#missing[@]} )); then
    case "$PKG_FAMILY" in
      apt)
        for tool in "${missing[@]}"; do
          case "$tool" in git) packages+=(git) ;; python3) packages+=(python3 python3-venv) ;; go) packages+=(golang-go) ;; esac
        done
        ;;
      dnf|yum)
        for tool in "${missing[@]}"; do
          case "$tool" in git) packages+=(git) ;; python3) packages+=(python3) ;; go) packages+=(golang) ;; esac
        done
        ;;
      apk)
        for tool in "${missing[@]}"; do
          case "$tool" in git) packages+=(git) ;; python3) packages+=(python3 py3-pip) ;; go) packages+=(go) ;; esac
        done
        ;;
      *) warn "Tidak ada package manager yang didukung untuk CLI tambahan: ${missing[*]}" ;;
    esac
    if (( ${#packages[@]} )); then
      # Do not abort WhatsApp/AI startup when optional host tools cannot be
      # installed; report exact capabilities that remain unavailable.
      install_packages "${packages[@]}" || warn "Instalasi CLI tambahan gagal; fitur yang memerlukannya akan tetap fail-closed."
    fi
  fi
  printf '[NEXORA_CLI_TOOLS] git=%s python3=%s go=%s bash=%s\n' \
    "$(command -v git >/dev/null 2>&1 && echo available || echo missing)" \
    "$(command -v python3 >/dev/null 2>&1 && echo available || echo missing)" \
    "$(command -v go >/dev/null 2>&1 && echo available || echo missing)" \
    "$(command -v bash >/dev/null 2>&1 && echo available || echo missing)"
}

ensure_cloudflared() {
  if command -v "$CLOUDFLARED_BIN" >/dev/null 2>&1; then
    log "cloudflared tersedia: $("$CLOUDFLARED_BIN" --version 2>&1 | head -n 1)"
    return 0
  fi
  log "cloudflared belum tersedia; mencoba instalasi resmi Cloudflare."
  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY RUN: akan memasang cloudflared dari repository/paket resmi yang sesuai OS ($PKG_FAMILY)."
    return 0
  fi
  if [[ "$PKG_FAMILY" == "apt" ]]; then
    install_packages ca-certificates curl gnupg
    local key_tmp
    key_tmp="$(mktemp)"
    if ! curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o "$key_tmp"; then rm -f "$key_tmp"; warn "Tidak dapat mengunduh signing key Cloudflare."; return 1; fi
    root_run install -d -m 0755 /usr/share/keyrings
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY RUN: signing key Cloudflare akan dipasang ke /usr/share/keyrings/cloudflare-main.gpg"
    else
      root_run gpg --dearmor --yes -o /usr/share/keyrings/cloudflare-main.gpg "$key_tmp"
      root_run chmod 0644 /usr/share/keyrings/cloudflare-main.gpg
    fi
    rm -f "$key_tmp"
    local list_tmp
    list_tmp="$(mktemp)"
    printf '%s\n' 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > "$list_tmp"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY RUN: menambahkan repository Cloudflare cloudflared."
    else
      root_run install -m 0644 "$list_tmp" /etc/apt/sources.list.d/cloudflared.list
      root_run apt-get update
      APT_UPDATED=1
    fi
    rm -f "$list_tmp"
    install_packages cloudflared
  elif [[ "$PKG_FAMILY" == "dnf" || "$PKG_FAMILY" == "yum" ]]; then
    install_packages curl
    local arch asset tmp
    arch="$(uname -m)"
    case "$arch" in x86_64|amd64) asset="x86_64" ;; aarch64|arm64) asset="aarch64" ;; *) warn "Arsitektur $arch belum didukung untuk cloudflared RPM."; return 1 ;; esac
    tmp="$(mktemp --suffix=.rpm)"
    if ! curl -fL --retry 3 "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${asset}.rpm" -o "$tmp"; then rm -f "$tmp"; warn "Unduhan paket cloudflared RPM gagal."; return 1; fi
    if [[ "$PKG_FAMILY" == "dnf" ]]; then root_run dnf install -y "$tmp"; else root_run yum localinstall -y "$tmp"; fi
    rm -f "$tmp"
  elif [[ "$PKG_FAMILY" == "apk" ]]; then
    install_packages cloudflared || { warn "cloudflared tidak tersedia di repository APK yang aktif."; return 1; }
  else
    warn "Instalasi cloudflared otomatis tidak didukung pada OS ini ($OS_ID)."
    return 1
  fi
  command -v "$CLOUDFLARED_BIN" >/dev/null 2>&1 || { warn "cloudflared belum ditemukan setelah instalasi."; return 1; }
  log "cloudflared berhasil disiapkan."
}

pid1_name() {
  ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]'
}

has_systemd_pid1() {
  [[ "$(pid1_name)" == "systemd" && -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1
}

wait_for_docker() {
  local attempts="${1:-25}"
  for ((i=0; i<attempts; i++)); do
    if docker info >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

start_dockerd_without_init() {
  command -v dockerd >/dev/null 2>&1 || { warn "dockerd tidak tersedia untuk startup manual."; return 1; }
  (( EUID == 0 )) || { warn "Startup dockerd manual memerlukan root. Runtime rootless/Podman akan dicoba sebagai fallback."; return 1; }
  command -v nohup >/dev/null 2>&1 || { warn "nohup tidak tersedia; tidak dapat menjalankan dockerd terlepas dari bootstrap."; return 1; }

  local lock_dir="/run/lock"
  local lock_file="${lock_dir}/nexora-dockerd-bootstrap.lock"
  local log_dir="${TMPDIR:-/tmp}/nexora-runtime"
  local log_file="${log_dir}/dockerd.log"
  local pid_file="${log_dir}/dockerd.pid"
  mkdir -p "$lock_dir" "$log_dir" 2>/dev/null || return 1
  chmod 700 "$log_dir" 2>/dev/null || true

  if command -v flock >/dev/null 2>&1; then
    exec 9>"$lock_file"
    if ! flock -n 9; then
      log "Startup dockerd lain sedang berjalan; menunggu daemon yang sama."
      wait_for_docker 25
      return $?
    fi
  else
    local mkdir_lock="${lock_file}.d"
    if ! mkdir "$mkdir_lock" 2>/dev/null; then
      log "Lock startup dockerd sudah ada; menunggu daemon yang sama."
      wait_for_docker 25
      return $?
    fi
    trap 'rmdir "${mkdir_lock}" 2>/dev/null || true' RETURN
  fi

  if docker info >/dev/null 2>&1; then
    log "Docker daemon menjadi siap sebelum startup manual; tidak membuat daemon baru."
    return 0
  fi

  if [[ -f "$pid_file" ]]; then
    local old_pid old_cmd
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    old_cmd=""
    # Validate the PID before opening /proc. Redirection is evaluated before
    # the command, so an empty/stale PID otherwise emits a noisy shell error.
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && (( old_pid > 1 )) && kill -0 "$old_pid" 2>/dev/null; then
      old_cmd="$(tr '\0' ' ' < "/proc/${old_pid}/cmdline" 2>/dev/null || true)"
    fi
    if [[ -n "$old_cmd" && "$old_cmd" == *dockerd* ]]; then
      log "dockerd bootstrap sebelumnya masih hidup (PID $old_pid); menunggu socket."
      wait_for_docker 25
      return $?
    fi
    rm -f "$pid_file"
  fi

  log "Tidak ada init/service manager aktif. Mencoba menjalankan satu dockerd host secara terkontrol (tanpa sudo karena proses sudah root)."
  : > "$log_file"
  chmod 600 "$log_file" 2>/dev/null || true
  nohup dockerd </dev/null >>"$log_file" 2>&1 9>&- &
  local daemon_pid=$!
  printf '%s\n' "$daemon_pid" > "$pid_file"
  chmod 600 "$pid_file" 2>/dev/null || true

  if wait_for_docker 30; then
    log "Docker daemon siap melalui startup manual (PID $daemon_pid)."
    return 0
  fi
  if ! kill -0 "$daemon_pid" 2>/dev/null; then
    warn "dockerd keluar sebelum socket siap. Diagnostik terakhir: $(tail -n 12 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-1000)"
  else
    warn "dockerd masih berjalan tetapi Docker API belum siap. Diagnostik terakhir: $(tail -n 12 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-1000)"
  fi
  return 1
}

ensure_docker_service() {
  command -v docker >/dev/null 2>&1 || {
    log "Docker CLI belum tersedia; mencoba memasang Docker Engine dari package manager $PKG_FAMILY."
    case "$PKG_FAMILY" in
      apt) install_packages docker.io || return 1 ;;
      dnf) install_packages docker || return 1 ;;
      yum) install_packages docker || return 1 ;;
      apk) install_packages docker docker-cli || return 1 ;;
      *) warn "Package manager $PKG_FAMILY tidak didukung untuk instalasi Docker."; return 1 ;;
    esac
  }

  if docker info >/dev/null 2>&1; then
    log "Docker daemon sudah aktif dan dapat diakses oleh user Ocha."
    return 0
  fi

  if has_systemd_pid1; then
    log "systemd benar-benar menjadi PID 1; mencoba systemctl start docker."
    if root_run systemctl start docker; then
      wait_for_docker 20 && return 0
    fi
    warn "systemctl start docker tidak membuat Docker API siap; akan mencoba fallback lain."
  elif command -v rc-service >/dev/null 2>&1 && [[ -e /run/openrc/softlevel ]]; then
    log "OpenRC aktif; mencoba rc-service docker start."
    root_run rc-service docker start || true
    wait_for_docker 20 && return 0
  elif [[ "$(pid1_name)" == "init" ]] && command -v service >/dev/null 2>&1; then
    log "SysV init aktif; mencoba service docker start."
    root_run service docker start || true
    wait_for_docker 20 && return 0
  else
    log "systemctl tersedia/tidak tersedia, tetapi systemd bukan PID 1. Tidak akan menjalankan systemctl palsu pada container non-systemd."
  fi

  if command -v dockerd >/dev/null 2>&1 && (( EUID == 0 )); then
    start_dockerd_without_init && return 0
  fi

  warn "Docker daemon masih tidak dapat diakses. Pemeriksaan fallback Podman akan dilanjutkan."
  return 1
}

ensure_images() {
  local runtime="$1"
  for image in "$PYTHON_IMAGE" "$NODE_IMAGE"; do
    if "$runtime" image inspect "$image" >/dev/null 2>&1; then
      log "Image tersedia pada $runtime: $image"
    else
      log "Image belum tersedia pada $runtime; menarik $image."
      "$runtime" pull "$image" || { warn "Gagal menarik image $image menggunakan $runtime."; return 1; }
      "$runtime" image inspect "$image" >/dev/null 2>&1 || { warn "Image $image belum lolos verifikasi setelah pull."; return 1; }
    fi
  done
}

ensure_docker_runtime() {
  ensure_docker_service || return 1
  docker info >/dev/null 2>&1 || return 1
  ensure_images docker || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

ensure_podman_runtime() {
  if ! command -v podman >/dev/null 2>&1; then
    log "Podman belum tersedia; mencoba instalasi paket Podman tanpa mengasumsikan systemd atau sudo."
    install_packages podman || return 1
  fi
  # Podman CLI is daemonless for normal run/pull commands. Do not require podman.socket.
  podman info >/dev/null 2>&1 || { warn "Podman tersedia tetapi host/storage/cgroup tidak mengizinkan podman info."; return 1; }
  ensure_images podman || return 1
  podman info >/dev/null 2>&1 || return 1
  return 0
}

ensure_runtime() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY RUN: runtime preference=$RUNTIME; Docker service/manual dockerd dan Podman daemonless akan dinilai tanpa menjalankan daemon."
    log "DRY RUN: akan memeriksa image $PYTHON_IMAGE dan $NODE_IMAGE untuk kandidat runtime yang tersedia."
    return 0
  fi
  local candidates=()
  case "$RUNTIME" in
    docker) candidates=(docker podman) ;;
    podman) candidates=(podman docker) ;;
    auto)
      if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then candidates=(docker podman)
      elif command -v podman >/dev/null 2>&1; then candidates=(podman docker)
      else candidates=(docker podman)
      fi
      ;;
  esac

  local selected=""
  for candidate in "${candidates[@]}"; do
    log "Menguji kandidat runtime: $candidate."
    if [[ "$candidate" == "docker" ]]; then
      if ensure_docker_runtime; then selected="docker"; break; fi
    elif [[ "$candidate" == "podman" ]]; then
      if ensure_podman_runtime; then selected="podman"; break; fi
    fi
    warn "Kandidat $candidate tidak siap; beralih ke kandidat berikutnya."
  done

  if [[ -n "$selected" ]]; then
    printf '[NEXORA_RUNTIME_SELECTED] %s\n' "$selected"
    log "Runtime aktif tervalidasi: $selected."
    return 0
  fi
  printf '[NEXORA_RUNTIME_SELECTED] none\n'
  warn "Docker dan Podman tidak dapat dijalankan pada host ini. Tidak akan mengubah permission socket atau memakai mode privileged secara otomatis."
  return 1
}

log "Memeriksa host: OS=$OS_ID runtime=$RUNTIME"
ensure_cli_tools || true
cloudflared_ok=0
runtime_ok=0
ensure_cloudflared && cloudflared_ok=1 || warn "Cloudflare tunnel belum siap; bot tetap dapat berjalan tanpa preview publik."
ensure_runtime && runtime_ok=1 || warn "Code execution runtime belum siap; Python/Node tetap fail-closed dan akan diuji ulang pada permintaan eksekusi berikutnya."
if [[ "$DRY_RUN" == "1" ]]; then
  log "Dry-run selesai. Ini adalah rencana tindakan, bukan konfirmasi bahwa dependensi sudah terpasang."
elif (( cloudflared_ok && runtime_ok )); then
  log "Semua dependensi Nexora tersedia."
else
  log "Bootstrap selesai dengan komponen opsional yang belum siap (Cloudflare=$cloudflared_ok, Runtime=$runtime_ok). Bot utama tetap dapat berjalan."
fi
exit 0
