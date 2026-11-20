# Nexora Host Bootstrap

`npm-deps.js` is the npm `prestart`/`predev` check. It verifies the declared runtime dependencies and runs `npm install --no-audit --no-fund` when a required package is missing or the installed dependency tree is invalid. Node.js and npm themselves must already be installed to invoke `npm start`.

`ensure-host.sh` is the one-shot, idempotent host prerequisite manager called by `src/runtime/bootstrap-agent.js` after `loadConfig()` and before Code Lab initialization.

It checks the configured container runtime, the two configured execution images, and the configured `cloudflared` executable. Missing supported components are provisioned with the OS package manager. Docker is enabled/started through the host service manager; it is not launched as a child daemon for each job. Images are pulled only when `image inspect` / `image exists` reports them missing.

The script exits after preflight. It does not create persistent per-user processes, terminal sessions, workers, or Cloudflare tunnels. The Code Lab owns one persistent shared `cloudflared` process separately.

## Supported package managers

- APT: Docker Engine via `docker.io`; `cloudflared` via Cloudflare's signed APT repository; Podman via distribution package.
- DNF/YUM: Docker/Podman via distribution packages; `cloudflared` via official Cloudflare RPM release.
- APK: Docker/Podman and `cloudflared` are attempted through enabled Alpine repositories. Availability depends on repository configuration.

Unsupported distributions are detected and left untouched. WhatsApp and AI chat still start if optional provisioning fails; Code Lab reports which prerequisite remains unavailable.

## Privileges

Run as root, or provide sudo access. In an interactive terminal, sudo is requested once. In non-interactive services, passwordless sudo is required for automatic installation/service activation. The script does not chmod the Docker socket or add the bot account to the `docker` group because that group grants root-equivalent host control.

## Dry run

```bash
NEXORA_BOOTSTRAP_DRY_RUN=1 bash scripts/bootstrap/ensure-host.sh docker python:3.12-alpine node:22-alpine cloudflared
```

Dry run prints planned operations and makes no package, service, repository, or image changes.
