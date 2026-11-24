# ACIE Runtime Isolation

See `ACIE_PART2_RUNTIME_ISOLATION.md` for the container policy and configuration. Contributed code never executes in the WhatsApp bot process. The sandbox runner uses digest-pinned Docker/Podman images, `--network=none`, read-only source, read-only container root, ephemeral `/tmp`, no inherited bot credentials, dropped Linux capabilities, non-root identity, bounded CPU/memory/process counts, execution timeout and pre/post SHA-256 verification.

A runtime is not available until `.acie runtime probe` succeeds for the configured absolute engine path and every configured image. Runtime review also requires a per-provider image matching its language and pinned by SHA-256 digest. No dependencies are installed into the original contribution.

The network is intentionally disabled. An internet-dependent provider will fail closed; do not replace `--network=none` with unrestricted access. Any future outbound access must use a separately reviewed allowlisted proxy, per-provider policy, destination restrictions and credential scoping.

TypeScript and Rust are not supported by the generic execution map yet. They remain static-discovery-only until dedicated build adapters are implemented and tested.
