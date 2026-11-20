# Nexora Code Lab

Code Lab is the isolated code-execution capability used by Ocha Lidya/Nexora. A user can ask the AI to run the most recent code block from the conversation, or use `.run` directly. Each execution gets a unique session ID and unguessable URL path. A single temporary TryCloudflare Quick Tunnel is shared by the gateway; per-session tokens keep previews separate without starting a new tunnel process for every request.

## Supported runtimes

- Python 3.12 (`python:3.12-alpine`), standard library only.
- Node.js 22 (`node:22-alpine`), standard library only.
- HTML/CSS/JavaScript, rendered in a sandboxed browser iframe.

Python and Node.js code runs inside a new, short-lived container for each session. The container has no network, no host credentials or Docker socket, a read-only source mount, non-root UID, dropped Linux capabilities, `no-new-privileges`, a 128 MiB memory limit, 0.5 CPU, 64 process limit, 8 MiB shared memory, 16 MiB temporary filesystem, bounded file size/open files, and a hard runtime timeout. The application also enforces a timeout and kills the associated container when the session is stopped or expires. Dependencies cannot be downloaded from the worker because network access is disabled; use language standard libraries.

HTML is not run in a Node/Python container. It is placed in an iframe with `sandbox="allow-scripts"`, no same-origin permission, and a restrictive Content Security Policy. It cannot access the preview page's cookies or JavaScript context.

## Public preview lifecycle

The local HTTP gateway binds only to `127.0.0.1` (default port `8787`). `cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate` opens a free Quick Tunnel and returns an ephemeral `trycloudflare.com` base URL. Session URLs use a unique path and 256-bit random token. The token is not logged or saved to the JSONL database.

A session URL expires after 60 minutes at most. At expiry, Ocha stops the worker, removes the container, revokes the URL token, deletes the source workspace, and removes the in-memory session. The shared Quick Tunnel stays alive for the lifetime of the Ocha process, even when there are no live sessions. It is not restarted per request and is not closed during idle periods. Each session has an independently revocable URL path/token. If the Quick Tunnel exits unexpectedly, the supervisor revokes current sessions (their old hostname cannot be assumed to survive), then reconnects with bounded backoff. At most one cloudflared child is managed by the Code Lab service at a time.

On `SIGINT`, `SIGTERM`, or `SIGHUP`, the bot performs graceful cleanup of workers, sessions, gateway, and tunnel. A detached orphan watchdog monitors a local heartbeat and removes containers labelled for that process instance, kills the recorded `cloudflared` process, and deletes its temporary workspace if the bot process is killed without running shutdown handlers. The worker command also has an in-container `timeout` as a second bound. This is best-effort process cleanup; no software can guarantee filesystem cleanup during a power loss, kernel crash, Docker daemon failure, or forced termination of the watchdog itself.

Cloudflare documents Quick Tunnels as development/testing only, with no uptime guarantee and a 200 in-flight request limit. Anyone who receives a session URL can view the preview and interact with its stdin form. Do not place secrets, private data, or production credentials in code or output. See Cloudflare's Quick Tunnel documentation: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/>.

## Concurrency and abuse controls

Defaults: two concurrent workers (owner-adjustable from one to four), 20 total live preview sessions, two live sessions per sender, three executions per sender per minute, 64 KiB source, 48 KiB captured output, and 120 seconds maximum program runtime. `workers` is the number of Python/Node programs actually running at the same time; it is not the session count. Requests above worker concurrency enter a FIFO queue. HTML previews do not start a container worker. Each runtime container is capped at 128 MiB RAM, so the default two-worker pool reserves at most roughly 256 MiB for container memory limits; four workers can use up to roughly 512 MiB, excluding Docker/Podman and bot overhead. Session IDs, container names, workspaces, and tokens are unique; there is no shared execution directory.

Execution is headless: no terminal tab, browser tab, or visible terminal window is opened on the VPS for each run. The bot owns one shared local HTTP gateway, one `cloudflared` process, and one orphan-cleanup watchdog. Python/Node work is started as a bounded Docker/Podman container only when a job is scheduled; container stdio is piped into the gateway, not attached to a terminal. The container is removed when its program exits, and its source workspace is deleted after completion; only bounded output/status remains in the in-memory preview session until expiry. The worker pool is limited to two by default and four maximum. This is a bounded background service, not an unlimited process-per-request design.

The worker container applies resource controls using Docker/Podman container options documented at <https://docs.docker.com/engine/containers/run/>. Rootless Podman is preferred where supported. If Docker is used, protect access to the Docker daemon; permission to control a rootful Docker daemon is effectively host-administrator access.

## VPS setup

Install Node.js 20.18+, Docker or rootless Podman, and `cloudflared`. Pull both supported runtime images before enabling public execution:

```bash
docker pull python:3.12-alpine
docker pull node:22-alpine
```

For Podman, replace `docker` with `podman`. Install `cloudflared` using Cloudflare's official installation guide for the target Linux distribution. No Cloudflare account or managed domain is required for a Quick Tunnel.

Start Ocha normally with `npm start`. On startup, the service independently verifies `cloudflared --version` and the Docker/Podman daemon plus both pre-pulled runtime images. It starts the loopback gateway and one shared Quick Tunnel as soon as `cloudflared` passes its check, even if the container runtime is temporarily unavailable. HTML preview can still work; Python/Node execution fails closed until the runtime and both images pass preflight. A missing `cloudflared` binary keeps public previews offline, while the WhatsApp bot itself remains available. Check `.nexora status` from the owner account. Install `cloudflared` once on the VPS; the app verifies and manages its single process but does not run privileged package-manager installation automatically.

## User flow

1. Ask Ocha to write code, for example: `buatkan implementasi kalkulator Python`.
2. After Ocha returns a fenced code block, say: `coba jalankan` or `buat preview hasilnya`.
3. Ocha selects the last assistant code block, creates a session, and replies with a `trycloudflare.com` URL.
4. For `input()` / `stdin` programs, open the preview and enter values in the Program Input field. For HTML, use the Web Preview panel.
5. The URL is revoked and the execution resources are removed at expiry, or when the Ocha process is shut down.

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

`ttlMs` is capped at 3,600,000 ms. The worker runtime limit is independent of preview TTL: a process is terminated after two minutes by default, while its captured output and preview page remain available until the one-hour session expiry.
