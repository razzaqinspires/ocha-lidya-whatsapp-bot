# Source Component Index — Ocha v1.10.56 paired maintenance

This is an additive index for the files changed or revalidated by the paired Ocha/AC maintenance cycle. It does not replace earlier full source indexes.

| Component ID      | Component                             | Source location                           | Key function / contract                                                                                           | Tests                                                                  | Status                             |
| ----------------- | ------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `NADI-LOAD`       | External AC component selection       | `src/runtime/nadi-component.js`           | `resolveNadiComponent()` selects validated `OCHA_NADI_SOURCE_DIR` first, otherwise existing pinned GitHub archive | `test/nadi-runtime.integration.test.js`, `test/nadi-component.test.js` | ACTIVE; local v2.1.1 path verified |
| `NADI-RUNTIME`    | Sidecar lifecycle and telemetry       | `src/runtime/consciousness-runtime.js`    | Start/stop sidecar, health/status polling, HTTP API v1 client                                                     | `test/nadi-runtime.integration.test.js`                                | ACTIVE; API contract unchanged     |
| `NADI-RELEASE`    | Two-base release builder              | `scripts/release-two-bases.js`            | Validate package pair and source provenance; allow explicit local snapshot when no Git SHA exists                 | paired release pipeline                                                | ACTIVE; no fake commit SHA         |
| `PRIVATE-RUNTIME` | Owner-designated private Ocha modules | `.private/ocha-private-runtime/`          | Private host bridges and original source package; verify manifest hashes                                          | `npm run private-runtime:verify`                                       | PRESERVED; source bytes unchanged  |
| `LUNARA-INTAKE`   | External contribution review          | `docs/contributions/LUNARA_PRO_REVIEW.md` | File-host/paste candidate security and compatibility review                                                       | no service tests; contribution remains held                            | ADAPTER_REQUIRED; not active       |

## Cross-base references

- AC implementation: `artificial-consciousness-component/ac/mimpi.py`, `ac/ingat.py`, `ac/intero.py`, `ac/kernel.py`.
- AC tests: `artificial-consciousness-component/selftest.py`, `artificial-consciousness-component/test_prime.py`.
- AC maintenance report: `artificial-consciousness-component/ARTIFICIAL_CONSCIOUSNESS_MAINTENANCE_REPORT.md`.
- Ocha integration documentation: `docs/NADI_RUNTIME.md`, `docs/TWO_BASE_RELEASE.md`.
- Paired QA: `docs/RELEASE_REPORT_1.10.56.md`.
