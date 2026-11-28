# NADI Maintenance Summary — Ocha v1.10.56 / AC v2.1.1

The independent Artificial Consciousness Component was advanced to local snapshot `ac-kernel-nadi@2.1.1` while preserving its separate source base. Ocha continues to communicate through NADI HTTP API v1; no Python implementation was copied into the Node.js repository.

## Implemented improvements

1. **MIMPI repeat-window protection.** `ac/mimpi.py::Dreamer.sleep_cycle()` fingerprints the selected episodic window using SHA-256 over ordered episode block hashes. It skips an already processed window, including after restart. `ac/ingat.py::EternalMemory.append_many()` commits the NREM/REM batch with a single atomic ledger flush; existing blocks remain append-only.
2. **INTEROCEPTION delayed-tick stability.** `ac/intero.py::Interoception.update()` uses substeps no larger than one second for deltas within 0–300 seconds. Social interaction is applied once as an impulse. `ac/kernel.py::Kernel.tick()` rejects invalid deltas before state mutation.

## Verification

- AC Python compilation: pass.
- AC core self-test: 6/6 pass.
- AC extended tests: 10/10 pass.
- Ocha-to-AC HTTP API v1 sibling-source integration: 1/1 pass (see paired QA report).
- Live VPS and authenticated WhatsApp transport: not tested in this environment.

## Provenance boundary

The AC source workspace did not contain `.git` metadata. The package is identified as a local paired snapshot; no commit SHA or GitHub push is claimed. To use v2.1.1, set `OCHA_NADI_SOURCE_DIR=../artificial-consciousness-component`. If unset, Ocha keeps its prior remote fallback commit for v2.1.0.

See `ARTIFICIAL_CONSCIOUSNESS_MAINTENANCE_REPORT.md` in the independent Artificial Consciousness Component base of the paired source bundle for subsystem details, experiment baselines, research limits and next objectives.
