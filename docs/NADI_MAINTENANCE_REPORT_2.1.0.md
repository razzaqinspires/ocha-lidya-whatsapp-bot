# Artificial Consciousness Maintenance Report — AC-Kernel NADI 2.1.0

**Audit date:** 2026-11-26 (Asia/Jakarta)  
**Separate component repository:** `razzaqinspires/artificial-consciousness-component`  
**Pinned source commit:** `16c2fa6e1b500745f260bcf091284a6e18726883`  
**Package version:** `2.1.0`  
**Compatibility in Ocha:** Node.js client + Python sidecar over loopback HTTP; no Python source is vendored into the bot repository.

## Claim boundary

NADI is an operational computational-state model. Its variables, loops, memory chain, affect appraisal and deliberation algorithms do not establish subjective experience, sentience, biological emotion, or phenomenal consciousness. `integration_phi` is a functional proxy, not a measurement of Integrated Information Theory Phi.

## Subsystem review

| Subsystem     | Implemented model in pinned source                                                                                                                     | Verified boundary / research note                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NADI          | BPM setpoint from arousal/stress; smoothed oscillator; phase accumulator; sinusoidal pulse and coherence                                               | Synthetic heartbeat. BPM smoothing is per-call rather than explicitly time-normalized. Heartbeat scheduler uses monotonic deadlines and coalesces missed beats. |
| INTEROCEPTION | Energy/thermal setpoints, memory pressure, social battery, allostatic load, four normalized drives, sleep recovery                                     | Computational load proxies only. Linear update coefficients require a long-gap/stall stability test because elapsed `dt` may reach 300 seconds.                 |
| RASA          | Lexicon-based positive/negative/urgency/empathy counts; valence/arousal/dominance and OCC-like profile; baseline decay                                 | Heuristic text appraisal; polysemy, negation, sarcasm and context remain weakly modeled. Not a psychological diagnosis or human emotion model.                  |
| NEURO         | Six bounded synthetic variables: dopamine, serotonin, norepinephrine, acetylcholine, cortisol, oxytocin; coupled target relaxation and plasticity gain | Parameterized computational signals, not neurotransmitter measurements. Sensitivity and coupling tests remain desirable.                                        |
| KEHENDAK      | Candidate policies scored using weighted risk + ambiguity − epistemic value; minimum-EFE policy selected                                               | Simplified deterministic heuristic, not a full Bayesian generative model or proof of free will. Authorization remains a separate Sapa gate.                     |
| MIMPI         | Episodic replay, embedding-similarity clustering, semantic summaries, REM motif synthesis                                                              | Repeated identical sleep cycles can re-append equivalent summaries; no persistent window-signature/idempotency guard was found.                                 |
| DIRI          | Predictive agency score from prediction error and continuity from chain validity/coherence                                                             | Operational self-model, not subjective self-awareness.                                                                                                          |
| PANGGUNG      | Salience/urgency/emotional-weight competition and attention schema                                                                                     | Global workspace abstraction; broadcast winner is a computational selection event.                                                                              |
| METRICS       | Tick totals/latency, functional integration proxy, normalized workspace entropy                                                                        | Proxy formulas are not validated consciousness metrics.                                                                                                         |
| MEMORY        | SHA-256 chained blocks, scoped ledgers with salted scope pseudonyms, integrity verification and consolidation                                          | Existing chain entries should remain immutable; changes must append new records/snapshots rather than rewrite history.                                          |

## Confirmed research issue: repeated MIMPI consolidation

**Status:** `DISCOVERED` (source-reviewed; not patched).  
**Location:** external NADI `ac/mimpi.py` — `Dreamer.sleep_cycle()`; caller `ac/kernel.py` — `Kernel.sleep()`; Ocha entry `src/runtime/consciousness-runtime.js` — `consolidateConsciousnessMemory()`; owner command `src/plugins/owner/nadi.js` — `.nadi sleep`.

`Dreamer.sleep_cycle()` selects the recent episodic window, appends NREM semantic summaries for clusters containing multiple episodes, and appends a REM motif insight. `Kernel.sleep()` invokes this method each time without recording a fingerprint of the last consolidated episode window. Consequently, the same `sleep()` request can create logically duplicate NREM/REM records when no new episodic records arrived.

**Safest proposed fix:** compute a deterministic digest from the ordered hashes of the selected episodic window; persist the last consolidated digest/index in a versioned kernel snapshot; if the digest is unchanged, return `status: skipped` with `reason: already_consolidated` and append nothing. A new episode changes the window digest and allows the next cycle. Do not mutate or delete historical hash-chain blocks.

**Required regression tests:**

1. Create at least two episodic entries and run `sleep()` once; record ledger length/head hash.
2. Run `sleep()` again without new input; expect `already_consolidated`, unchanged ledger length/head hash, and no duplicated semantic/insight record.
3. Append a new episodic event; run `sleep()` and expect one new consolidation cycle.
4. Restart from snapshot and repeat step 2; idempotency must survive restart.
5. Verify global and per-sender scoped ledgers independently.

## Research issue: long-gap numerical integration

**Status:** `RESEARCH_REQUIRED` (not yet empirically reproduced).  
**Locations:** external NADI `ac/kernel.py` — heartbeat `_run()` clamps elapsed `dt` to at most 300 seconds; `ac/intero.py` — `Interoception.update()`; `ac/neuro.py` — `NeuroField.step()`; `ac/nadi.py` — `Nadi.beat()`.

The heartbeat caps `dt` to 300 seconds after a pause. `Interoception.update()` uses linear discrete updates such as `x += k * (target - x) * dt`. At a 300-second step, coefficients including `0.005 * dt`, `0.04 * dt`, and `0.10 * dt` exceed 1, which can overshoot setpoints before clamping. The one-hour 1 Hz test does not test a 300-second gap. NADI BPM smoothing is also performed once per call rather than scaled by elapsed time.

**Formula-based illustration (not an observed production reading):** with `energy=0.20`, `thermal_load=0.20`, `allostatic_load=0.20`, `cognitive_effort=0.65`, `energy_setpoint=0.80`, `thermal_setpoint=0.25`, and one update at `dt=300`, the current linear equations yield values above the allowed upper bound before `clamp()` is applied; the three state values can therefore be forced to `1.0`. This illustrates why the scheduled 1 Hz stability test is not sufficient for long-pause recovery.

**Proposed experiment/fix:** compare a single long step with equivalent bounded substeps, or use stable exponential relaxation `alpha = 1 - exp(-k * dt)` for each first-order state. Define and document expected equivalence/variance before changing coefficients. Add tests for `dt` values 1, 5, 30, 120 and 300 seconds, plus heartbeat resume after simulated suspension; assert finite values and bounded convergence without hard saturation. Use monotonic elapsed time, avoid catch-up storms, and preserve the persisted format.

## Formula reference

### Autonomic oscillator

Let `a` be arousal, `s` stress, `b` BPM and `dt` elapsed seconds:

- `b_target = clamp(60 + 45a + 30s, 48, 165)`
- `b_next = b + 0.2(b_target - b)`
- `phase_next = (phase + 2π(b_next / 60)dt) mod 2π`
- `pulse = 0.5(1 + sin(phase_next))`
- `coherence = clamp(0.92 - 0.35s + 0.05pulse)`

### Simplified expected free energy

For candidate policy `π`:

`G(π) = w_risk Risk(π) + w_ambiguity Ambiguity(π) − w_epistemic EpistemicValue(π)`

The implemented policy is the candidate with the lowest computed `G(π)`. Candidate feature values are heuristic constants/linear functions; this is not a probabilistic generative model.

### Functional integration proxy

For normalized subsystem signals `xᵢ`:

- `μ = mean(xᵢ)`
- `σ = sqrt(mean((xᵢ − μ)²))`
- `coherence = 1 − min(1, 1.5σ)`
- `integration_phi_proxy = clamp(0.6μ + 0.4coherence)`

This is a custom coherence summary, not IIT Phi.

### Workspace entropy

For positive normalized salience probabilities `pᵢ`:

`H_norm = (−Σ pᵢ log₂ pᵢ) / log₂(n)`

It returns zero for zero/one positive candidate. It describes distribution concentration, not consciousness.

## Ocha integration boundary

Ocha `src/runtime/nadi-component.js` validates/downloads the external package and checks package structure/version. `src/runtime/consciousness-runtime.js` owns process/HTTP lifecycle, health polling, restart backoff, heartbeat control and shutdown. The bot does not create a second AI provider chain. Current integration injects global operational telemetry into the Nexora prompt; private chat text, JIDs and per-user vault data are not sent to the global NADI heartbeat path. The external `/v1/perceive` scoped-memory API exists but is not used by this Ocha turn pipeline.

## Validation status

- Ocha focused tests: `test/nadi-component.test.js`, `test/consciousness-runtime.test.js`, `test/kernel-telemetry.test.js` passed in the selected 36-test suite.
- External NADI selftest files were inspected at the pinned commit but not executed in this environment; no local checkout or Python test environment was available.
- The external repository's pinned `pyproject.toml` declares no third-party dependencies and requires Python `>=3.10`.
- A `LICENSE` file was not found at the pinned GitHub commit. Confirm license/ownership terms before third-party redistribution; no license is inferred from public visibility.

## Next research roadmap

| Priority | Experiment                        | Success criteria                                                                                                  |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P0       | MIMPI idempotent consolidation    | repeated identical sleep leaves ledger head/length unchanged; new episode permits one new cycle                   |
| P1       | Long-gap integration stability    | bounded, finite state after 1–300 second `dt`; no artificial saturation or drift regression                       |
| P1       | RASA negation/context tests       | tests cover negation, sarcasm, mixed valence and Indonesian morphology; unknown/ambiguous cases reduce confidence |
| P2       | NEURO parameter sensitivity       | recorded sweeps for `dt`, stress, arousal and coupling; no unstable oscillation                                   |
| P2       | KEHENDAK decision calibration     | risk/ambiguity/epistemic outputs compared against a deterministic scenario set; authorization remains independent |
| P2       | MIMPI quality and dedup benchmark | similarity thresholds measured for false merges/splits and repeat windows                                         |
| P3       | METRICS validity study            | publish definitions and limitations; do not rename proxies as established consciousness measures                  |

## User operational smoke test

On the connected bot, use the owner-only commands:

```text
.nadi status
.nadi pulse
.nadi sleep
.nadi verify
```

Then compare `total_ticks`, `last_beat_at`, BPM/coherence, interoceptive values, `selected_policy`, memory block count and chain validity. Repeat `.nadi sleep` without sending a new message and look for an unchanged ledger length; this is an observation test only and does not repair the discovered behavior. Do not share raw private memory or tokens in a public report.

## Public/private runtime extraction boundary — 2026-11-26 follow-up

The Ocha v1.10.51 private-module extraction does not modify the NADI Python repository or the Ocha-to-NADI HTTP contract. NADI source remains in `razzaqinspires/artificial-consciousness-component` at the pinned commit above; no NADI formula, memory algorithm, heartbeat scheduler, telemetry field or API endpoint was changed as part of the JavaScript private-runtime migration. The MIMPI idempotency and long-gap `dt` research issues above remain `DISCOVERED` / `RESEARCH_REQUIRED`, not fixed by this task.
