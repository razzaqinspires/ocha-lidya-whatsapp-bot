#!/usr/bin/env bash
# Idempotent Nexora host prerequisite manager.
# Installs only missing host packages/images. It never starts per-job daemons.
set -Eeuo pipefail

RUNTIME="${1:-docker}"
PYTHON_IMAGE="${2:-python:3.12-alpine}"
NODE_IMAGE="${3:-node:22-alpine}"
CLOUDFLARED_BIN="${4:-cloudflared}"
DRY_RUN="${NEXORA_BOOTSTRAP_DRY_RUN:-0}"

log() { printf '[NEXORA BOOTSTRAP] %s\n' "$*"; }
warn() { printf '[NEXORA BOOTSTRAP] WARNING: %s\n' "$*" >&2; }
fail() { warn "$*"; exit 1; }

[[ "$RUNTIME" == "docker" || "$RUNTIME" == "podman" ]] || fail "Runtime tidak didukung: $RUNTIME (pilih docker atau podman)."
for image in "$PYTHON_IMAGE" "$NODE_IMAGE"; do
  [[ "$image" =~ ^[A-Za-z0-9._/:@-]+$ ]] || fail "Nama image tidak valid: $image"
done
[[ "$CLOUDFLARED_BIN" != *" "* ]] || fail "cloudflaredBin tidak boleh berisi argumen; gunakan path executable saja."

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY RUN aktif; tidak ada perubahan host yang dilakukan."
fi

SUDO=()
ROOT_READY=1
if (( EUID != 0 )); then
  if ! command -v sudo >/dev/null 2>&1; then
    ROOT_READY=0
    warn "sudo tidak tersedia. Paket host yang memerlukan hak root tidak dapat dipasang otomatis."
  elif [[ "$DRY_RUN" != "1" ]]; then
    if [[ -t 0 ]]; then
      sudo -v || { ROOT_READY=0; warn "Otorisasi sudo gagal."; }
    else
      sudo -n true >/dev/null 2>&1 || { ROOT_READY=0; warn "Tidak ada sudo non-interaktif. Jalankan npm start dari sesi yang dapat meminta sudo atau atur service dengan hak instalasi."; }
    fi
    (( ROOT_READY == 0 )) || SUDO=(sudo -n)
  else
    SUDO=(sudo)
  fi
fi

root_run() {
  if [[ "$DRY_RUN" != "1" && "$EUID" != "0" && "$ROOT_READY" == "0" ]]; then
    warn "Hak root/sudo tidak tersedia untuk: $*"
    return 1
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[NEXORA BOOTSTRAP] DRY RUN root command:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  if (( EUID == 0 )); then "$@"; else "${SUDO[@]}" "$@"; fi
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

ensure_docker_service() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    log "Docker daemon sudah aktif dan dapat diakses oleh user Ocha; tidak perlu mengubah service."
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1 || ! command -v dockerd >/dev/null 2>&1; then
    log "Docker Engine belum lengkap; memasang paket daemon Docker."
    case "$PKG_FAMILY" in
      apt) install_packages docker.io ;;
      dnf) install_packages docker ;;
      yum) install_packages docker ;;
      apk) install_packages docker docker-cli ;;
      *) warn "Tidak dapat memasang Docker otomatis pada package manager $PKG_FAMILY."; return 1 ;;
    esac || return 1
  else
    log "Docker CLI dan dockerd ditemukan, tetapi daemon belum dapat diakses; mencoba mengaktifkan service."
  fi
  if command -v systemctl >/dev/null 2>&1; then
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY RUN: systemctl enable --now docker"
    else
      root_run systemctl enable --now docker || { warn "Gagal mengaktifkan docker.service."; return 1; }
    fi
  elif command -v rc-service >/dev/null 2>&1; then
    if [[ "$DRY_RUN" == "1" ]]; then log "DRY RUN: rc-update add docker default && rc-service docker start"
    else root_run rc-update add docker default || true; root_run rc-service docker start || return 1; fi
  elif command -v service >/dev/null 2>&1; then
    if [[ "$DRY_RUN" == "1" ]]; then log "DRY RUN: service docker start"
    else root_run service docker start || return 1; fi
  else
    warn "Service manager tidak ditemukan; daemon Docker tidak dapat dijalankan otomatis."
    return 1
  fi
  if [[ "$DRY_RUN" != "1" ]]; then
    docker info >/dev/null 2>&1 || { warn "Docker daemon belum dapat diakses oleh user proses Ocha. Periksa docker info dan izin socket; skrip tidak mengubah permission socket atau menambahkan user ke grup docker secara otomatis."; return 1; }
  fi
}

ensure_runtime() {
  if [[ "$RUNTIME" == "docker" ]]; then
    ensure_docker_service || return 1
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY RUN: akan memeriksa dan menarik image Docker yang belum tersedia."
      log "DRY RUN: docker pull $PYTHON_IMAGE"
      log "DRY RUN: docker pull $NODE_IMAGE"
      return 0
    fi
    for image in "$PYTHON_IMAGE" "$NODE_IMAGE"; do
      if docker image inspect "$image" >/dev/null 2>&1; then log "Image tersedia: $image"
      else log "Image belum tersedia; menarik $image"; docker pull "$image" || return 1; fi
    done
    docker info >/dev/null 2>&1 || { warn "Docker daemon tidak siap setelah image diperiksa."; return 1; }
  else
    if [[ "$DRY_RUN" == "1" ]]; then
      if ! command -v podman >/dev/null 2>&1; then log "DRY RUN: akan memasang paket Podman."; fi
      log "DRY RUN: akan memeriksa dan menarik image Podman yang belum tersedia."
      log "DRY RUN: podman pull $PYTHON_IMAGE"
      log "DRY RUN: podman pull $NODE_IMAGE"
      return 0
    fi
    if ! command -v podman >/dev/null 2>&1; then
      log "Podman belum tersedia; memasang paket Podman."
      install_packages podman || return 1
    fi
    podman info >/dev/null 2>&1 || { warn "Podman tidak dapat diakses oleh user proses Ocha."; return 1; }
    for image in "$PYTHON_IMAGE" "$NODE_IMAGE"; do
      if podman image exists "$image"; then log "Image tersedia: $image"
      else log "Image belum tersedia; menarik $image"; podman pull "$image" || return 1; fi
    done
  fi
  log "$RUNTIME dan image runtime siap."
}

log "Memeriksa host: OS=$OS_ID runtime=$RUNTIME"
cloudflared_ok=0
runtime_ok=0
ensure_cloudflared && cloudflared_ok=1 || warn "Cloudflare tunnel belum siap; bot tetap dapat berjalan tanpa preview publik."
ensure_runtime && runtime_ok=1 || warn "Code execution runtime belum siap; Python/Node akan tetap dinonaktifkan sampai pemeriksaan berikutnya."
if [[ "$DRY_RUN" == "1" ]]; then
  log "Dry-run selesai. Ini adalah rencana tindakan, bukan konfirmasi bahwa dependensi sudah terpasang."
elif (( cloudflared_ok && runtime_ok )); then
  log "Semua dependensi Nexora tersedia."
else
  log "Bootstrap selesai dengan komponen opsional yang belum siap (Cloudflare=$cloudflared_ok, Runtime=$runtime_ok). Bot utama tetap dapat berjalan."
fi
exit 0
