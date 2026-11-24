# ACIE Adapter Engineering

Adapter descriptors and bridge code are stored outside the immutable Contribution Vault. The generic contract is `acie-json-stdio-v1` for CLI-style entrypoints: one bounded JSON object on stdin and one JSON object on stdout. Stdout is machine data only; stderr is bounded diagnostics and is never forwarded to end users.

The supported generic entrypoint map currently covers JavaScript/Node.js, Python, Go, PHP, Java source-launch and Bash. TypeScript and Rust require dedicated build adapters and remain static-analysis-only. The generic runner does not install dependencies into the contribution. Runtime images must already include required dependencies or use a separately reviewed isolated cache.

Export-only libraries are not automatically adapted because static discovery cannot safely infer call signatures, side effects, argument requirements or output schemas. They require a manually authored bridge in the external adapter area. The wrapper must not rename, rewrite, patch or format original source. Preserve the contributor's package manifests and lockfiles byte-for-byte.

## Descriptor review and protocol test

- `.acie adapter review <provider-id>` validates the descriptor and marks it reviewed.
- `.acie adapter test <provider-id> [capability-id]` executes only after license, attribution, adapter, sandbox and owner authorization review; it requires a working, probed sandbox.
- `.acie commands test <command-id>` runs the provider protocol test for the command's capability.
- `.acie provider enable <provider-id>` is refused until protocol test and every activation gate pass.

A failed re-test clears both provider and adapter protocol success markers, preventing stale test evidence from activating a provider.

## Network and output policy

The current sandbox uses `--network=none`. Internet-dependent adapters cannot retrieve remote media through this execution policy. Do not pass Ocha API keys, `.env`, bot sessions, host home folders or writable vault mounts into the container. Output normalization only accepts supported response fields, HTTPS references and sanitized metadata. Local paths are not WhatsApp attachments; this release returns links as text rather than uploading arbitrary files.
