# AI Response Quality Guard — Ocha Lidya v1.10.49

## Purpose

Prevent a substantive user request from being replaced with a generic conversational invitation such as “Apa yang ingin kamu lakukan hari ini?”. Pure greetings still use the existing deterministic greeting shortcut.

## Request classification

`src/ai/response-quality.js` separates pure greetings/acknowledgements from substantive user turns. A substantive turn includes a multi-word question or task request. The classifier is deliberately small and deterministic; it does not claim to be a general semantic correctness evaluator.

## Response guard

After the provider chain returns and truncation handling completes:

1. If the user replied to a quote and the model returns a generic invitation, the existing quoted-context fallback is used.
2. If the user sent a substantive, non-quoted turn and the model returns only a known generic invitation, Ocha schedules one correction attempt.
3. The correction uses the same successful provider where known, a lower temperature, a bounded output budget, and the original job deadline.
4. If the correction is still generic or fails, Ocha uses a local fallback that preserves the requested subject and does not invent facts.

The repair outcome is logged with a job ID/provider/reason only. User message and response contents are not added to the new diagnostic log.

## Current-information policy

When the user asks for information “today”, “now”, “latest”, or similar, the prompt requires a real source retrieval before making current factual claims. The Gaza fallback is intentionally transparent: when no real-time source was retrieved, Ocha says that it cannot verify current conditions and asks for a supplied article/link to summarize. It does not fabricate casualty figures, humanitarian conditions, or field developments.

This does not add a web/news retrieval provider. Current-event retrieval remains unavailable unless a separately approved and implemented source capability is connected.

## Configuration

No new environment variable is required. The guard is enabled in the AI response pipeline. Pure greeting behavior and provider order remain unchanged.

## Validation

- Unit tests cover greetings, substantive-turn classification, generic non-answer detection, safe current-event fallback, and non-generic answer pass-through.
- Integration tests simulate a generic first response followed by a valid correction, and a second generic response that must be suppressed by the local fallback.
- The correction is limited to one attempt per turn.

## Limitations

The current guard detects known short generic deflections; it is not a semantic fact-checker and cannot detect every long or subtly irrelevant answer. A true answer relevance evaluator and live news retrieval should be separate capabilities with their own provider, source, timeout, privacy and validation policies.
