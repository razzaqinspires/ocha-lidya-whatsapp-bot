# Nexora Host Bootstrap

`npm start` menjalankan `prestart` untuk memeriksa dependency Node, lalu `src/index.js` memuat konfigurasi dan memanggil `runNexoraBootstrap()` sebelum Code Lab diinisialisasi. Bootstrap host berjalan otomatis pada Linux; ia tidak bergantung pada `sudo` jika proses sudah berjalan sebagai root.

`ensure-host.sh` adalah provisioning satu kali yang idempotent. Ia memeriksa `cloudflared`, runtime container, dan image Python/Node. Runtime preference menerima `auto`, `docker`, atau `podman`. Urutan kandidat dimulai dari pilihan konfigurasi dan selalu mencoba runtime alternatif bila kandidat pertama gagal.

## Docker startup strategy

1. Gunakan Docker daemon yang sudah dapat diakses.
2. Jika PID 1 benar-benar systemd, mulai service dengan `systemctl start docker`.
3. Jika OpenRC atau SysV benar-benar menjadi init host, gunakan service manager tersebut.
4. Jika tidak ada init manager dan proses berjalan sebagai root, coba `dockerd` sebagai satu daemon host terkontrol dengan lock file, PID file, log terpisah, dan pemeriksaan API.
5. Jika Docker tidak dapat dipulihkan, coba Podman.

Pemeriksaan systemd tidak hanya melihat keberadaan perintah `systemctl`: PID 1 dan `/run/systemd/system` harus menunjukkan systemd aktif. Ini mencegah kegagalan seperti `systemctl ... refusing` pada container yang tidak menjalankan systemd.

## Podman fallback

Podman CLI bersifat daemonless untuk operasi normal `podman run`, `pull`, dan `image inspect`; bootstrap tidak mensyaratkan `podman.socket` atau systemd. Mode rootless tetap membutuhkan dukungan user namespaces, pemetaan subordinate UID/GID (`/etc/subuid` dan `/etc/subgid`), serta storage/networking yang didukung host. Podman tetap harus lolos `podman info`, pemeriksaan storage/cgroup, dan verifikasi image.

## Privileges and safety

- Jika UID proses adalah 0, perintah administrasi berjalan langsung; `sudo` tidak dibutuhkan.
- Jika bukan root, bootstrap hanya memakai `doas -n` atau `sudo -n` yang sudah dapat diakses tanpa prompt. Ia tidak mengirim password atau membuka prompt interaktif dari `npm start`.
- Bootstrap tidak menjalankan `chmod 666 /var/run/docker.sock`, tidak menambah user ke grup `docker`, dan tidak mengaktifkan `--privileged` secara otomatis. Akses Docker socket setara kontrol root atas host.
- Startup `dockerd` manual hanya dilakukan sebagai root, hanya ketika Docker API belum hidup, dan dilindungi lock agar `npm start` paralel tidak membuat daemon kedua. Jika host tidak mengizinkan nested container/cgroups/networking, Docker akan dinyatakan unavailable dan Podman dicoba.

## Graceful degradation

WhatsApp, AI chat, gateway HTML, dan preview statis tetap dapat berjalan ketika tidak ada runtime container. Python/Node execution tetap fail-closed. Kegagalan runtime opsional dilaporkan sebagai `WARN`, bukan fatal `ERROR`; `.nexora status` menampilkan runtime preference, runtime yang terpilih, dan alasan bila keduanya tidak dapat dipakai. Pemeriksaan runtime diulang ketika Code Lab diminta menjalankan program.

## Dry run

```bash
NEXORA_BOOTSTRAP_DRY_RUN=1 bash scripts/bootstrap/ensure-host.sh auto python:3.12-alpine node:22-alpine cloudflared
```

Dry run tidak memasang paket, memulai daemon, menarik image, atau mengubah service.
