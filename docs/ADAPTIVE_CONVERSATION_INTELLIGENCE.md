# Adaptive Conversation Intelligence — v1.10.27

## Purpose

This layer improves task interpretation when the requested capability is not currently installed. It prevents Ocha from ending every unsupported request with a rigid denial, while preserving the runtime registry as the source of truth.

## Decision flow

1. Resolve the authenticated sender and chat scope.
2. Check the live plugin/capability registry.
3. If the requested capability is already installed, use its registered path and normal backend policy.
4. If it is absent, identify the intended outcome and offer a real alternative or a feature-development path.
5. A short confirmation such as `buat aja` is accepted only when recent conversation history contains both the original feature request and Ocha's preceding offer to prepare it.
6. Only a verified owner in a private DM can create an internal development-backlog entry.
7. The request is stored as an encrypted event in that owner's User Vault. A model response cannot write plugin source, alter runtime config, install code, or activate the feature.
8. Report the actual persisted status; never say the feature is installed before source review, syntax validation, hot reload, and runtime tests succeed.

## Current structured game proposals

The feature request catalog currently recognizes Tic-Tac-Toe, Sudoku, Chess, and UNO.

Tic-Tac-Toe acceptance criteria include a server-side per-account game session, legal X/O and board-cell validation, turn enforcement, win/draw detection, a deterministic legal Ocha strategy (minimax or equivalent), restart recovery, explicit stop/reset/status actions, and user-session isolation.

This release records the proposal only. It does not install a game engine. Part 3 is the implementation phase for the actual game state machine and gameplay plugin.

## Private feature backlog

The owner can use these commands in a private DM:

- `.features list` — show open and in-progress requests.
- `.features all` — show open and closed requests.
- `.features show <request-id>` — show full requirements.
- `.features progress <request-id> [note]` — move a request to in-progress.
- `.features complete <request-id> [note]` — mark complete after actual verification.
- `.features cancel <request-id> [note]` — cancel a request.
- `.features reopen <request-id> [note]` — reopen a request.

The command independently verifies the owner identity and reads only that owner's private vault. Status updates are appended as new events; request history is not rewritten.

## Interactive message policy

Plain WhatsApp text is the default. AI-generated interactive plans are accepted only when the current user's message explicitly requests the matching UI:

- buttons / quick replies;
- a list or single-select menu;
- a copy button for a code shown in the response;
- a URL button for the exact HTTPS URL supplied by the user.

The response parser still validates allowed item counts, rejects command-like prompts, restricts URL CTA destinations, and checks that copy codes exist in the visible answer. A user asking about buttons or reporting a button error is not, by itself, consent to send interactive UI.

## Security boundaries

- The language model is not an authorization source.
- Feature proposals are accepted only after backend verification of the owner and private-chat context.
- Feature backlog data is encrypted within the owner's own User Vault.
- No other user can list, retrieve, update, or infer these owner development entries through their own vault.
- Level, XP, familiarity, and trust do not grant owner privileges.
- AI response UI is presentation only and cannot execute privileged commands.

## Known limitations

This layer currently records requests for four recognized games. It does not create arbitrary plugins from free-form user text. Plugin authoring remains a separate owner-only, staged workflow using `.createcmd`, source validation, workload assessment, and explicit `.createcmd apply <draft-id>` approval. Live WhatsApp interactive rendering and the actual game engine are validated in later integration work.
