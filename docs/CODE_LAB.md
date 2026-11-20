# Nexora Code Lab

Code Lab is the isolated code-execution capability used by Ocha Lidya/Nexora. A user can ask the AI to run the most recent code block from the conversation, or use `.run` directly. When the user replies to an AI message, Code Lab reads the quoted message text first; it does not require the AI reply-chain anchor to exist. If the quoted fenced block is incomplete, Nexora asks the AI provider to complete it before execution, and refuses to execute if the repaired block is still incomplete. Each execution gets a unique session ID and unguessable URL path. One temporary TryCloudflare Quick Tunnel is shared by the gateway while previews are active; per-session tokens keep previews separate without starting a new tunnel process for each request or user.

## Supported runtimes

- Python 3.12 (`python:3.12-alpine`), standard library only.
- Node.js 22 (`node:22-alpine`), standard library only.
- HTML/CSS/JavaScript, rendered in a sandboxed browser iframe.

Python and Node.js code runs inside a new, short-lived container for each session. The container has no network, no host credentials or Docker socket, a read-only source mount, non-root UID, dropped Linux capabilities, `no-new-privileges`, a 128 MiB memory limit, 0.5 CPU, 64 process limit, 8 MiB shared memory, 16 MiB temporary filesystem, bounded file size/open files, and a hard runtime timeout. The application also enforces a timeout and kills the associated container when the session is stopped or expires. Dependencies cannot be downloaded from the worker because network access is disabled; use language standard libraries.

HTML is not run in a Node/Python container. It is placed in an iframe with `sandbox="allow-scripts"`, no same-origin permission, and a restrictive Content Security Policy. It cannot access the preview page's cookies or JavaScript context.

## Public preview lifecycle

The local HTTP gateway binds only to `127.0.0.1` (default port `8787`). `cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate` opens a free Quick Tunnel and returns an ephemeral `trycloudflare.com` base URL. Session URLs use a unique path and 256-bit random token. The token is not logged or saved to the JSONL database.

A session URL expires after 60 minutes at most. At expiry, Ocha stops the worker, removes the container, revokes the URL token, deletes the source workspace, and removes the in-memory session. Code Lab starts the shared Quick Tunnel only when the first public preview is requested; concurrent users and sessions reuse the same hostname and the same `cloudflared` child process. When the final live session and pending creation disappear, the tunnel remains for the configured idle grace period (five minutes by default), then shuts down. Each session has an independently revocable URL path/token. If the Quick Tunnel exits unexpectedly, Ocha revokes sessions that depended on the old hostname and applies bounded exponential backoff; it does not run an unbounded background restart loop. A later real preview request starts a fresh Quick Tunnel and returns its new hostname. Start, stop, restart, and lease cleanup are serialized, and the process must emit `close` before a replacement can start.

On `SIGINT`, `SIGTERM`, or `SIGHUP`, the bot performs graceful cleanup of workers, sessions, gateway, and tunnel. A detached orphan watchdog monitors a local heartbeat and removes containers labelled for that process instance, kills the recorded `cloudflared` process, and deletes its temporary workspace if the bot process is killed without running shutdown handlers. The worker command also has an in-container `timeout` as a second bound. This is best-effort process cleanup; no software can guarantee filesystem cleanup during a power loss, kernel crash, Docker daemon failure, or forced termination of the watchdog itself.

Cloudflare documents Quick Tunnels as development/testing only, with no uptime guarantee, a hard limit of 200 in-flight requests, no Server-Sent Events (SSE), and a hostname that changes whenever a new Quick Tunnel is created. Code Lab uses short polling, not SSE. Anyone who receives a session URL can view the preview and interact with its stdin form. Do not place secrets, private data, or production credentials in code or output. See Cloudflare's Quick Tunnel documentation: <https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>.

## Concurrency and abuse controls

Defaults: two concurrent workers (owner-adjustable from one to four), 20 total live preview sessions, two live sessions per sender, three executions per sender per minute, 64 KiB source, 48 KiB captured output, and 120 seconds maximum program runtime. `workers` is the number of Python/Node programs actually running at the same time; it is not the session count. Requests above worker concurrency enter a FIFO queue. HTML previews do not start a container worker. Each runtime container is capped at 128 MiB RAM, so the default two-worker pool reserves at most roughly 256 MiB for container memory limits; four workers can use up to roughly 512 MiB, excluding Docker/Podman and bot overhead. Session IDs, container names, workspaces, and tokens are unique; there is no shared execution directory.

Execution is headless: no terminal tab, browser tab, or visible terminal window is opened on the VPS for each run. The bot owns one shared local HTTP gateway, at most one active `cloudflared` process while preview sessions need it, and one orphan-cleanup watchdog after the first public preview is requested. Python/Node work is started as a bounded Docker/Podman container only when a job is scheduled; container stdio is piped into the gateway, not attached to a terminal. The container is removed when its program exits, and its source workspace is deleted after completion; only bounded output/status remains in the in-memory preview session until expiry. The worker pool is limited to two by default and four maximum. This is a bounded background service, not an unlimited process-per-request design.

The worker container applies resource controls using Docker/Podman container options documented at <https://docs.docker.com/engine/containers/run/>. Rootless Podman is preferred where supported. If Docker is used, protect access to the Docker daemon; permission to control a rootful Docker daemon is effectively host-administrator access.

## VPS setup

Install Node.js 20.18+, Docker or rootless Podman, and `cloudflared`. Pull both supported runtime images before enabling public execution:

```bash
docker pull python:3.12-alpine
docker pull node:22-alpine
```

For Podman, replace `docker` with `podman`. Install `cloudflared` using Cloudflare's official installation guide for the target Linux distribution. No Cloudflare account or managed domain is required for a Quick Tunnel.

Start Ocha normally with `npm start`. The host dependency manager may check or provision the `cloudflared` binary and Docker/Podman dependencies during startup, but Code Lab starts only the loopback gateway and does not launch a long-running `cloudflared` process at bot startup. On the first real public preview request, Code Lab verifies the binary, acquires an exclusive cross-process lease, starts one shared Quick Tunnel, and reuses it for every user and session. The tunnel is shut down after the configured idle grace period when no preview sessions or pending creations remain. HTML preview can still work; Python/Node execution fails closed until the runtime and both images pass preflight. A missing `cloudflared` binary keeps public previews offline, while the WhatsApp bot itself remains available. Check `.nexora status` from the owner account. Install `cloudflared` once on the VPS; the app verifies and manages its single process but does not run privileged package-manager installation automatically.

## User flow

1. Ask Ocha to write code, for example: `buatkan implementasi kalkulator Python`.
2. After Ocha returns a fenced code block, say: `coba jalankan` or `buat preview hasilnya`.
3. Ocha selects the last assistant code block, creates a session, and replies with a `trycloudflare.com` URL.
4. For `input()` / `stdin` programs, open the preview and enter values in the Program Input field. For HTML, use the Web Preview panel.
5. The URL remains available while its session is alive. When every preview session expires or is removed, the shared tunnel is stopped after the idle grace period. The execution resources are also removed at expiry or process shutdown.

Direct execution is also available:

```text
.run python ```python
print("Hello from Ocha")
```

.run node ```javascript
console.log("Hello from Node")
```
```

## Owner capability management

```text
.nexora status
.nexora all on
.nexora all off
.nexora code on
.nexora code off
.nexora auto-run on
.nexora auto-run off
.nexora tunnel on
.nexora tunnel off
.nexora workers 4
.nexora runtime docker
.nexora runtime podman
```

`.nexora all on/off` is the global master switch: it enables/disables the AI chat engine, Code Lab, AI auto-run and public preview tunnel together. Individual controls remain available for maintenance: `code` controls the execution service, `auto-run` controls natural-language execution through Nexora (it does not disable the direct `.run` command), `tunnel` controls the one shared public TryCloudflare process, `workers` changes concurrent execution from one to four, and `runtime` selects Docker or Podman. All controls are owner-only and private-chat-only and apply to every user. Turning Code Lab or the public tunnel off revokes active preview sessions, stops workers, and closes the shared tunnel.

The capability registry is separate from model/provider settings. Nexora can have AI chat enabled while a specific capability is disabled. Code execution is routed only when an explicit run/execute/test/preview intent is detected and a code block exists in the current request or earlier assistant history. Otherwise the request continues through the normal AI response path.

## Configuration

Persistent settings live under `codeLab` in `src/config.js` and the JSONL configuration journal. The v1.8.0/v1.8.1 schema migrations add defaults without modifying `.env` or existing provider secrets. Key defaults:

```js
codeLab: {
  enabled: true,
  aiExecutionEnabled: true,
  publicTunnelEnabled: true,
  cloudflaredBin: 'cloudflared',
  containerRuntime: 'docker',
  port: 8787,
  ttlMs: 3600000,
  tunnelIdleMs: 300000,
  maxRuntimeMs: 120000,
  maxSourceBytes: 65536,
  maxOutputBytes: 49152,
  maxConcurrent: 2,
  maxSessionsTotal: 20,
  maxSessionsPerUser: 2,
  maxExecutionsPerMinute: 3,
  pythonImage: 'python:3.12-alpine',
  nodeImage: 'node:22-alpine'
}
```

`ttlMs` is capped at 3,600,000 ms. The worker runtime limit is independent of preview TTL: a process is terminated after two minutes by default, while its captured output and preview page remain available until the one-hour session expiry. `tunnelIdleMs` controls how long the shared `cloudflared` process stays alive after the last preview session disappears; the default is five minutes, and `0` disables idle shutdown (the process then remains active until the service is stopped).

## Website Builder projects (v1.9.0)

Nexora Website Builder publishes multi-file static frontend projects through the same shared gateway. Each website session has its own tokenized URL, but does not spawn its own tunnel, terminal, or container. Project files are stored in bounded memory and removed when the session expires. See `docs/NEXORA_WEBSITE_BUILDER.md` for format limits, CSP, iframe isolation, owner controls, and backend limitations.



## Automatic host dependency manager (v1.9.2)

When `npm start` is invoked, npm first runs `prestart` (`scripts/bootstrap/npm-deps.js`). It checks the required Node dependencies and runs `npm install --no-audit --no-fund` when a dependency is missing or `npm ls --depth=0` reports an invalid dependency tree. After the main process loads the persistent configuration, `src/index.js` runs `scripts/bootstrap/ensure-host.sh` through the Nexora dependency manager before Code Lab starts. The host check is idempotent: it checks the selected Docker/Podman runtime, the Python and Node runtime images, and `cloudflared`; it installs only missing packages, starts an existing Docker service, and pulls only images that are not already present. Both checks run synchronously during startup and exit; they do not create a per-user background process, extra terminal, or additional Cloudflare tunnel. Code Lab creates no long-lived `cloudflared` process at bot startup. On the first preview request it obtains an exclusive lock and starts exactly one shared Quick Tunnel. Concurrent session requests reuse that process. Start/stop/restart transitions are serialized; shutdown waits for the previous process to exit before another can start. A second process sharing the same Code Lab temp directory is blocked by the lease. After the last session expires or is explicitly revoked, the tunnel is stopped after `tunnelIdleMs`. The local gateway admits at most 160 in-flight requests and returns HTTP 503 with `Retry-After: 2` when that local limit is reached, leaving headroom below Cloudflare Quick Tunnel’s hard 200 in-flight request limit.

On Debian/Ubuntu, the manager uses the distribution Docker Engine package when the daemon is missing and Cloudflare's signed APT repository for `cloudflared`. On RPM-based systems it uses the available `dnf`/`yum` package manager and the official Cloudflare RPM release. Podman is installed from the distribution package manager. Other distributions are detected but may require manual provisioning.

If root privileges are needed, the manager uses the current root session or requests `sudo` once when an interactive terminal is available. It does not silently change Docker socket permissions, add the bot user to the `docker` group, or run untrusted install scripts. If privilege escalation is unavailable, the bot continues to start and reports that Code Lab dependencies remain unavailable; normal WhatsApp/AI chat is not blocked. Docker group membership is effectively root access, so it is deliberately not granted automatically.

The default images are `python:3.12-alpine` and `node:22-alpine`. The manager checks each with `docker image inspect` (or Podman equivalent) and pulls only missing images. `NEXORA_BOOTSTRAP_DRY_RUN=1` can be used to inspect the intended actions without installing packages or changing the host.

## Docker daemon troubleshooting

The Docker CLI being installed does not mean the Docker Engine daemon is running. If `.nexora status` reports a missing `/var/run/docker.sock` or cannot connect to the Docker API, start the daemon on a systemd VPS with `sudo systemctl enable --now docker`, then confirm `docker info` succeeds. Only after the daemon is healthy should the runtime images be pulled. If the `docker.service` unit does not exist, install Docker Engine (the server/daemon package), not only the Docker CLI. Do not expose the Docker socket to untrusted containers.
