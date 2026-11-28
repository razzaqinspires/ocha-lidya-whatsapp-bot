# Ocha Lidya Paired Maintenance Report — v1.10.56 + AC v2.1.1

Date: 2026-11-26

## Release identity

- Ocha: `ocha-lidya-whatsapp-bot@1.10.56` (Node.js ESM, Node >=20.18.0).
- Private runtime package: `@razzaqventures/ocha-private-runtime@1.10.56`.
- Independent component: `ac-kernel-nadi@2.1.1` (Python >=3.10).
- Integration contract: secured NADI HTTP API v1; API route/schema contract unchanged.
- Source roots supplied as extracted workspaces without `.git` metadata. No new Git commit SHA or push is claimed. Ocha retains remote fallback commit `16c2fa6e1b500745f260bcf091284a6e18726883` for NADI v2.1.0. The supplied paired AC v2.1.1 source is selected by `OCHA_NADI_SOURCE_DIR=../artificial-consciousness-component`.
- The two ZIPs are separate source bases. Ocha's local-operator ZIP includes ignored `.private/` modules and must never be uploaded to public GitHub.

## Main work

1. Carried out the Ocha environment inventory from v1.10.55: 58 unique static names, 260 JavaScript environment access sites, 9 shell expansion sites, 25 whole-environment pass-through sites and 4 dotenv load/reload sites. `.env.example` remains generated and source-checked; the paired bundle's `OCHA_NADI_SOURCE_DIR` points to the sibling AC source package. No `.env` secrets were read or packaged.
2. Maintained the Lunara Pro contribution in `DISCOVERED` / `ANALYZED` / `ADAPTER_REQUIRED` status. No client execution, endpoint upload, command registration or provider activation occurred because original byte source, license/permission and server API contract were not provided/verified.
3. Updated AC MIMPI to fingerprint its selected episodic window and skip repeated consolidation, including after restart. `EternalMemory.append_many()` commits derived blocks with one atomic ledger flush; old history remains append-only.
4. Updated AC INTEROCEPTION to integrate long time deltas in maximum one-second substeps, apply the social interaction impulse once, and reject invalid `dt` before `Kernel.tick()` mutates state.
5. Updated the paired release builder to encode local source snapshot provenance with `sourceCommit: null`; it does not manufacture a Git SHA.

## Verification

| Check                             | Result                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ocha `npm run check`              | PASS; 294 JavaScript files syntax-checked and env inventory current                                          |
| Ocha environment inventory        | PASS; 313 JS + 3 shell files, 58 unique names, 13 unresolved computed reads confined to tests                |
| Ocha `npm run docs:check`         | PASS; 80 Markdown files and local links                                                                      |
| Ocha private runtime verification | PASS; 4 immutable source modules verified                                                                    |
| Ocha publication security audit   | PASS; 421 files inspected, 395 public and 26 private excluded; no private fingerprints/credential findings   |
| Ocha NADI HTTP v1 integration     | PASS; 1/1 against sibling AC v2.1.1 source                                                                   |
| Ocha direct `node --test`         | PASS with environment limitation; 406 total, 405 passed, 0 failed, 1 skipped                                 |
| Ocha `npm test` lifecycle         | NOT COMPLETED; `pretest` attempted to bootstrap seven missing dependencies and timed out in this environment |
| AC Python compile                 | PASS                                                                                                         |
| AC `selftest.py`                  | PASS; 6/6                                                                                                    |
| AC `test_prime.py`                | PASS; 10/10                                                                                                  |
| Prettier format check             | NOT AVAILABLE; CLI not installed, so formatting check was not executed                                       |
| Live VPS / WhatsApp transport     | NOT TESTED; no authorized running host/session supplied                                                      |
| Live Lunara API contract          | NOT TESTED; no payload sent to the external service                                                          |

The one skipped Ocha test is the private-runtime live import test requiring the missing Baileys peer dependency. Direct `node --test` runs the assertions without the `pretest` dependency-bootstrap hook; it does not establish that `npm test` lifecycle or WhatsApp transport works on the target VPS.

## Artificial Consciousness Maintenance Report

Subsystems reviewed: NADI heartbeat, INTEROCEPTION, RASA, NEURO, KEHENDAK, MIMPI, DIRI, PANGGUNG, METRICS/MEMORY and secured HTTP sidecar.

Measured baseline and updated behavior:

| Measurement                            |                   v2.1.0 baseline |                             v2.1.1 paired snapshot |
| -------------------------------------- | --------------------------------: | -------------------------------------------------: |
| Repeat identical MIMPI window          | second sleep added 1 ledger block | second sleep added 0 blocks and returned `skipped` |
| `dt=300` thermal load                  |                               1.0 |                                             0.2987 |
| `dt=300` allostatic load               |                               1.0 |                                             0.0186 |
| `dt=300` cool drive                    |                               1.0 |                                             0.0682 |
| 300s integration vs 300 x 1s reference |    no bounded-substep equivalence |      all five state variables match within `1e-10` |

Details, assumptions, formula governance, limitations and research roadmap are in the independent base's `ARTIFICIAL_CONSCIOUSNESS_MAINTENANCE_REPORT.md`.

## Installation pairing

Extract the two archives into sibling directories. In the Ocha `.env`, set:

```dotenv
OCHA_NADI_SOURCE_DIR=../artificial-consciousness-component
```

Then install dependencies on the target operator host and run `npm test` and `npm start`. If you intentionally leave `OCHA_NADI_SOURCE_DIR` empty, Ocha uses the existing remote pinned NADI v2.1.0 fallback rather than the v2.1.1 local snapshot.

## Known limitations and next improvements

- Restore dependency bootstrap in a network-enabled target environment, then complete `npm test`; specifically install the pinned Baileys peer and remove the one test skip.
- Run the paired source on the actual VPS and verify `.nadi status`, `.nadi pulse`, `.nadi sleep`, `.nadi verify`, heartbeat recovery and dashboard telemetry.
- Run a reviewed Git diff against the current upstream repositories before publishing; do not push ZIP-extracted trees as if they were a Git checkout.
- Complete MIMPI overlapping-window analysis and consider exponential closed-form INTEROCEPTION relaxation as the next numerical research item.
- Continue NADI drift/restart, NEURO sensitivity, PANGGUNG/DIRI coherence and metrics integrity experiments.
- Resume Lunara only after original file bytes, contributor attribution, licensing, server schema, retention policy, upload/download limits and redirect/auth behavior are provided and verified.

## Claim boundary

NADI uses synthetic computational variables and models. These results show bounded, testable software behavior; they do not demonstrate subjective consciousness, sentience, biological emotion or human physiology.
