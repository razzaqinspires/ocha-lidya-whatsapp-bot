# Public Kernel Dashboard — Ocha Lidya / AC-Kernel NADI

## Command

The public command is `.kernel`. Aliases are `.kernelstatus` and `.nadiweb`. The plugin lives at `src/plugins/general/kernel.js`, has no owner-only or private-chat restriction, and is exempt from group rental command quota. It can be invoked in a group or a private chat, subject to the bot's existing global `public`/`self` mode, group mute policy, and anti-spam/cooldown controls.

The command asks the existing Nexora Code Lab gateway for its shared HTTPS TryCloudflare URL and sends a native-flow `cta_url` button named **Buka WebView Kernel**. If the client does not render the CTA, the same public URL is sent as plain text. It does not open a second HTTP listener and does not expose NADI's loopback API.

## Dashboard contents

The page is read-only and refreshes its JSON snapshot every 2.5 seconds. It includes:

- Total inbound messages, separated into private chats and groups.
- Total outbound bot messages and correlated responding turns, separated into private chats and groups.
- AI requests, completed AI answers, failures, currently active requests, success ratio, provider totals, and rolling response latency (average, P95, minimum, maximum; up to 512 successful-answer samples).
- Hourly inbound and AI-response activity for the latest 24 hours, plus a bounded event feed.
- NADI oscillator, pulse wave, coherence, homeostasis, six synthetic neuromodulator fields, synthetic affect/OCC appraisal, predictive self-model, EFE policy evaluations, integration proxy, workspace entropy, memory ledger metadata, WhatsApp connection state, and Node process diagnostics.
- Formula notes for each mathematical subsystem represented in the dashboard.

Counters are cumulative from the first dashboard telemetry initialization on the installed version. They are not reconstructed from old WhatsApp history. They continue across normal process restarts using `data/kernel/telemetry.json`.

## Privacy boundary

The public page exposes aggregate counters and numeric runtime state only. It does not expose message content, chat names, phone numbers, raw JIDs, sender IDs, per-user profiles, private conversation history, private memory, NADI's self-narrative, or workspace broadcast content. Event rows contain only a generic event type, channel class, timestamp, and optional provider/latency fields.

The share URL contains a 256-bit random path token persisted in `data/kernel/public-dashboard-token`. Anyone who receives the URL can view the dashboard. Treat it as a public URL. Rotating access: stop the bot, back up then remove `data/kernel/public-dashboard-token`, and restart. The next `.kernel` invocation generates a new token. The TryCloudflare hostname is ephemeral and may change when the tunnel is recreated; issue `.kernel` again to obtain the current URL.

The route accepts GET only, uses no-store headers, a restrictive CSP, token hash comparison, and rate limiting. The dashboard shares the Code Lab Quick Tunnel, so turning off Code Lab or its public tunnel also makes the dashboard unavailable. The public view never opens the NADI sidecar port.

## Required host settings

The shipped defaults already enable `codeLab.enabled` and `codeLab.publicTunnelEnabled`. The host must have the configured `cloudflared` binary available. If the tunnel is disabled by `.nexora tunnel off`, or Code Lab is globally disabled, `.kernel` returns an operational error instead of publishing a local URL.

```js
codeLab: {
  enabled: true,
  publicTunnelEnabled: true,
  cloudflaredBin: 'cloudflared'
}
```

Run `npm start`, then invoke `.kernel` from WhatsApp. The first request may start the shared Quick Tunnel. The dashboard route keeps that tunnel alive while the bot process remains active; it is not subject to Code Lab's ordinary idle-tunnel shutdown. Graceful bot shutdown still stops the gateway and tunnel.

## Metric interpretation

The figures are operational telemetry, not evidence of subjective experience. NADI is an explicit computational model. Its pulse is a software oscillator, its homeostasis fields are normalized computational variables, its affect/neuromodulator values are synthetic appraisal variables, agency/continuity are model scores, and integration Φ is a proxy computed from subsystem signals—not IIT Φ. The project does not claim biological emotion, sentience, independent will, or phenomenal consciousness.

`botRespondingTurns` increments on the first outgoing message correlated to a tracked incoming WhatsApp message. `botOutputMessages` counts outgoing bot messages whether or not they correlate to an inbound message. `aiResponses` counts successful response-generation/delivery results from the Nexora AI engine; plugin/command replies are not mislabelled as AI-generated answers. `aiFailures` counts failed AI-engine invocations. Message-monitor correlation depends on the outgoing message retaining its quoted source key, including interactive replies.

## Persistence and verification

- Telemetry file: `data/kernel/telemetry.json`, created with restrictive directory/file permissions and atomic replacement.
- Public dashboard token: `data/kernel/public-dashboard-token`, mode `0600` where supported.
- Do not commit the `data/kernel/` directory or share its token file separately.
- Validate source syntax with `npm run check`.
- Run the isolated aggregate-telemetry test with `node --test test/kernel-telemetry.test.js`.
