# ACIE Part 2 — Runtime Isolation & Provider Orchestration

## Scope

Part 2 adds a fail-closed container execution boundary, an external adapter descriptor/protocol, runtime probing, and provider routing through that boundary. It does not execute contributed source during intake or static analysis.

## Adapter contract

Adapters live outside `contributions/vault`. The descriptor uses `acie-json-stdio-v1`:

- One JSON object is written to stdin (maximum 256 KiB).
- The provider must write exactly one JSON object to stdout (maximum 1 MiB).
- Diagnostics belong on stderr; stderr is bounded and is never forwarded to users.
- The adapter descriptor must match provider and contribution IDs.
- `execution.enabled` must remain false until owner review and protocol validation are recorded.

This protocol currently supports CLI-style contributions. Export-only libraries require a separately reviewed bridge wrapper; ACIE does not guess function signatures or mutate the contributed project to make it executable.

## Container boundary

The runner supports Docker or Podman through an absolute engine path. It invokes the engine with an argument array (`shell:false`) and does not inherit the bot process environment. Containers use:

- digest-pinned images (`image@sha256:<64 hex>`),
- `--network=none`,
- read-only root filesystem,
- original contribution mounted read-only at `/acie/source`,
- no Linux capabilities and `no-new-privileges`,
- non-root UID/GID 65534,
- bounded memory, CPU, PID count, stdout/stderr and wall-clock time,
- ephemeral `/tmp` only; no host writable mount and no bot credentials.

The runner verifies contribution SHA-256 immediately before execution. It never installs dependencies into the vault. Dependency caches and build outputs must be contained in the ephemeral container filesystem.

## Runtime configuration

`config/acie.runtime.json` is private runtime state and is not shipped with the source archive. ACIE creates conservative defaults. An operator must configure:

```json
{
  "sandbox": {
    "configured": true,
    "engine": "docker",
    "enginePath": "/usr/bin/docker",
    "images": {
      "javascript": "registry.example/acie-node@sha256:<64-hex-digest>",
      "python": "registry.example/acie-python@sha256:<64-hex-digest>"
    },
    "timeoutMs": 20000,
    "resources": { "memory": "256m", "cpus": 1, "pids": 64 }
  }
}
```

The image strings above are examples only. Replace them with reviewed images and actual immutable digests. Never use `latest` or an unpinned tag. Keep images minimal, patched, non-root capable, and with no secrets baked in.

Run `.acie runtime probe` from the owner's private chat after configuration. The probe checks the engine daemon and each configured image. Runtime availability remains false if any configured image fails inspection.

## Language compatibility

The adapter runner currently dispatches direct CLI entrypoints for JavaScript, Python, Go, PHP, Java source-launch mode, and Bash. TypeScript and Rust remain statically discoverable but are not executable through this generic adapter yet; they require a reviewed build adapter. Mixed-language contributions are assigned a runtime based on the selected entrypoint extension, not by assuming every file shares one runtime.

Go/Java projects with external dependencies may fail when the image does not contain a locked dependency set. Network is disabled during execution. A separate dependency preparation workflow and signed/offline dependency cache are future work; no dependency is installed into original source.

## Routing and fallback

The provider router selects only active providers that pass governance, integrity, adapter, runtime, owner authorization, quota, availability and circuit-breaker gates. The router invokes only the internal sandbox runner; a caller-supplied executor callback is not used. Fallback is attempted only when the request is declared idempotent and the error classifier marks the failure retryable. Authentication, invalid input, quota exhaustion and invalid output do not trigger blind retries.

## Activation checklist

1. Human review of license and attribution.
2. Static security findings reviewed.
3. Adapter descriptor reviewed and protocol tested in the isolated runtime.
4. Digest-pinned image configured and `.acie runtime probe` succeeds.
5. Contribution integrity verifies immediately before execution.
6. Owner explicitly authorizes execution.
7. Output contract is verified.
8. Only then can provider activation pass the registry gate.

A configured Docker daemon alone is not a security guarantee. Production deployment should also apply host-level daemon isolation, rootless mode where available, seccomp/AppArmor/SELinux policy, disk quotas, image scanning and host patching.


## Part 3 integration

Part 3 adds owner-reviewed virtual command plugins, command/alias collision resolution, menu/help discovery through the existing Ocha plugin loader, provider health persistence and response normalization. These additions do not weaken the Part 2 runtime controls. See `ACIE_PART3_COMMAND_INTEGRATION.md` for the full activation checklist.
