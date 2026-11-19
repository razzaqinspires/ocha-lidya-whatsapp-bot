# Quoted reply routing and message test lab

## Two quoted-reply lanes

Incoming dispatch follows this order:

1. Existing group-interaction mute policy is evaluated. When groups are muted, group command/AI interaction is stopped; metadata and contact ingestion still runs earlier in the event pipeline.
2. The command reply-session registry checks the exact quoted message ID in the current chat. A match is owned by the sender who opened the screen. This lane runs before command parsing and AI detection.
3. Normal prefixed command parsing runs.
4. AI routing runs only after no command was selected. In groups, AI can start from an explicit bot mention or a quoted message ID registered as an AI answer. A quote to a command screen, menu, or other bot message does not qualify as an AI answer.

A reply session contains a screen kind, a list of valid choices, a handler, and a TTL. It is keyed by `chat JID + quoted screen message ID`, expires after 10 minutes by default, and is consumed before its handler is called. An invalid value returns the allowed choices and keeps the screen open. In a group, another member cannot select a screen created by someone else. Session state is in memory only; after a process restart the user runs the command again.

Serializer API:

```js
await m.replyWithSession('Pilih item:\n1. Grup A\n2. Grup B', {
  kind: 'example-list',
  choices: [
    { key: '1', label: 'Grup A', value: { groupId: 'a@g.us' } },
    { key: '2', label: 'Grup B', value: { groupId: 'b@g.us' } }
  ],
  helpText: 'Balas 1 atau 2.',
  onSelect: async ({ sock, message, value }) => {
    await message.reply(`Selected ${value.groupId}`);
  }
});
```

## `.groupinfo` reply navigation

Run `.groupinfo` in a private chat. Reply to the actual list screen, not by sending a standalone number:

- `1`-`10`: open the corresponding cached group on the quoted page.
- `0`: next page when one exists; from a detail screen, return to the list page.
- `00`: previous page when one exists.

Each new page/detail screen receives its own session and quoted message ID. The existing cache remains `data/group-metadata.jsonl`; reply sessions do not duplicate group metadata or cause repeated `groupMetadata()` requests.

## Bounded AI quote chain

Every AI answer that returns a WhatsApp message ID is persisted as an `ai.reply.anchor` record with `chat`, `messageId`, `jobId`, `parentJobId`, `threadId`, and `depth`. Its associated user/assistant turns already exist as `ai.turn` records. When a user quotes an AI answer, the engine resolves only that exact answer's parent chain, orders turns from root to leaf, and appends the new user text plus the immediate quoted text.

Bounds: 8 linked AI answer levels, 12,000 characters of prior chain content, and 2,500 characters for the immediate quoted message. The model is explicitly instructed to treat only this supplied chain as context, not unrelated messages in the chat. At the depth boundary a new branch starts, but the immediate quote is still included. Old AI answers created before the anchor feature do not have automatic anchors; new and recovered answers are indexed from v1.7.0. If a delivery has no returned message ID, it cannot be a future quote anchor.

## Baileys type notes

- `MessageType` in Baileys is a TypeScript alias for `keyof proto.Message`, not a runtime enum that can be reflected into a complete list in this JavaScript process. `.test types` therefore prints a curated list of useful message keys used by the serializer/lab.
- `WAMessageStubType` maps to `proto.WebMessageInfo.StubType`. It describes server-generated system events such as group changes; a stub is not a regular outgoing payload to create through `sendMessage()`.
- `ButtonBuilder` is a local Ocha helper API (`sock.buttonBuilder()` and `sock.ButtonBuilder()`), not a class exported as part of Baileys' public API. It builds native-flow payloads through the project's own `Button` class.
- Hydrated four-row template messages use the `templateMessage.hydratedTemplate` WAProto shape. Native-flow quick replies and CTA buttons use interactive payloads and may be treated differently by WhatsApp clients.

Baileys references:

- [Baileys `Types/Message.ts`](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/Message.ts) — `MessageType`, `WAMessageStubType`, poll/event content types, PTV and view-once options.
- [Baileys `Socket/messages-send.ts`](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/messages-send.ts) — high-level message generation and the mapping of event, poll, PTV and view-once send options into protocol message objects.
- [Baileys WAProto schema](https://github.com/WhiskeySockets/Baileys/blob/master/WAProto/WAProto.proto) — hydrated template button variants.

## `.test` message lab

All lab commands are owner-only. They send real outgoing test messages to the current chat; use a private test chat or a test group where appropriate.

| Command | Payload / purpose |
|---|---|
| `.test types` | Curated `proto.Message` message-key reference |
| `.test stubtypes` | Runtime `WAMessageStubType` enum names and values |
| `.test button halo` | Project `ButtonBuilder` with a native-flow quick reply |
| `.test quick_reply [text]` | Two quick-reply buttons |
| `.test nativeflow [url]` | Quick reply, URL, call and copy CTA buttons |
| `.test cta_url <https-url>` | CTA URL native-flow button |
| `.test cta_call <number>` | CTA call native-flow button (`phone_number`) |
| `.test selection` | Native-flow `single_select` with two rows |
| `.test location_button` | `send_location` native-flow action |
| `.test address_button` | `address_message` native-flow action |
| `.test catalog_button` | `cta_catalog` action (account capability-dependent) |
| `.test legacy_button [text]` | Raw WAProto legacy `buttonsMessage` payload (compatibility test) |
| `.test reminder [text]` | Reminder and cancel-reminder native-flow CTA names |
| `.test image <url> [caption]` / `.test video <url> [caption]` / `.test audio <url>` / `.test document <url>` / `.test sticker <webp-url>` | Media message payloads |
| `.test location <latitude> <longitude> [name]` | Location message payload |
| `.test contact` | Contact-card message through the serializer |
| `.test hydrated [text]` | Hydrated four-row template with reply/URL/call buttons |
| `.test event [name] [ISO-date]` / `.test date ...` | Event message with start/end date |
| `.test poll Question \| Option A \| Option B` | Poll creation message, one selectable answer |
| `.test circle <video-url>` | Video note / PTV (`video` + `ptv: true`) |
| `.test viewonce <image-url>` | View-once image wrapper |
| `.test airich [text]` | Project AI rich-response builder |
| `.test carousel` | Two-card interactive carousel |

`<video-url>` and `<image-url>` must be reachable from the bot host and return compatible media. A successful relay/send call or protocol ACK does not prove that every WhatsApp version renders the card/action identically. Reminder CTA names and other native-flow controls are client-/server-capability-dependent and need live validation. `eventMessage` is the supported high-level dated-event payload in this lab; a standalone WhatsApp date-picker UI is not exposed by Baileys' normal `sendMessage` content API, so it is not mislabeled as a button. The lab does not emulate incoming button taps or create fake `WAMessageStubType` events.
