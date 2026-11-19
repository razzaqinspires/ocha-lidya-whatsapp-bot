# Contact database and group metadata cache

## Storage boundaries

The project uses two independent JSONL files with different retention rules:

- `data/contact.jsonl`: permanent contact index. A contact is never removed because someone leaves a group or the bot leaves a group.
- `data/group-metadata.jsonl`: event log for metadata belonging to WhatsApp groups. A group entry is removed from the active in-memory cache when the bot leaves/is removed; a `group.delete` event records the deletion.

The files are created with restrictive directory/file permissions (`0700` directory, `0600` file) during startup. They are outside the main hash-chained journal because they are dedicated high-churn indexes with independent replay rules.

## Contact format and deduplication

`contact.jsonl` is newline-delimited JSON: one object per line, not a single JSON array. Each row has exactly these fields:

```json
{"number":"6283193905842","name":"","gender":""}
{"number":"6282177461231","name":"","gender":""}
```

The `number` is digits only, without `@s.whatsapp.net`. `name` and `gender` are deliberately blank. At boot, the contact loader builds a Map keyed by number. Duplicate or invalid historical rows trigger a one-time compact rewrite; the original bytes are copied to `data/quarantine/contact.jsonl.<timestamp>.pre-dedupe` first. All later writes re-check the Map inside a serialized write queue before appending and fsyncing, so concurrent message/group events cannot insert duplicate numbers.

The write API accepts only an explicit PN JID ending in `@s.whatsapp.net`. A LID's numeric part is never converted into a phone number. Group metadata's explicit `phoneNumber` property is accepted as a verified PN field; if Baileys returns it as digits rather than a JID, the field name itself identifies its PN semantics.

## PN/LID resolution order

Baileys v7 introduced alternate addressing for messages when the visible remote/participant JID can be a LID. The resolver follows the available message-key fields without assuming every version provides every property:

Private messages, first match wins:

1. `key.senderPn`
2. `key.remoteJidPn`
3. `key.remoteJidAlt`
4. `key.remoteJid` only if it is itself a PN JID

Group messages:

1. `key.senderPn`
2. `key.participantPn`
3. `key.participantAlt`
4. `key.participant` only if it is itself a PN JID

When no explicit PN field exists, the pipeline may call Baileys' `signalRepository.lidMapping.getPNForLID(lid)`. That result is accepted only if it is a valid PN JID. If the mapping is absent, the original LID remains the sender identity. Never derive PN digits by stripping `@lid`.

The serializer and incoming message pipeline both consume this resolution. This matters for three independent behaviors: permanent contact capture, owner recognition in private chats, and correct message sender identity. The actual group chat JID remains the `@g.us` JID; only participant identity is resolved to PN where a verified mapping exists.

References:

- Baileys v7 migration guide: `remoteJidAlt` / `participantAlt` alternate addressing and PN/LID mapping notes: https://github.com/WhiskeySockets/Baileys/blob/master/MIGRATION.md
- Baileys issue #2263 discusses the `lid-mapping.update` event not always being emitted and recommends using the message's alternate PN fields / the SignalRepository mapping rather than assuming that event alone is complete: https://github.com/WhiskeySockets/Baileys/issues/2263
- Baileys current group metadata implementation exposes participant fields including `id`, `phoneNumber`, `lid`, `username`, and `admin`: https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/groups.ts


## Outgoing owner contact card

The `.owner` command sends a WhatsApp contact message through the serializer helper `m.sendContact()` rather than returning only a phone number and `wa.me` link. The helper resolves the destination chat JID using the serializer's PN/LID rules, validates the owner number as 8-15 international digits, builds a vCard, and sends it with `sock.sendMessage()` so the normal outgoing-message observer can track the message ID.

The vCard uses both `N` (structured name) and `FN` (formatted name), a `TEL` field with the WhatsApp `waid`, and the `displayName` property inside the individual `contacts[]` item. This intentionally follows the correction documented in WhiskeySockets/Baileys issue [#1135](https://github.com/WhiskeySockets/Baileys/issues/1135), where the README example's outer `contacts.displayName` and `FN`-only name were reported to produce a generic or blank contact name. No fabricated email address, social URL, or address is added.

The target chat may be represented by a LID. The serializer resolves it only from explicit PN alternate fields or Baileys' verified `signalRepository.lidMapping`; it never converts numeric LID fragments into phone numbers. See [#1465](https://github.com/WhiskeySockets/Baileys/issues/1465) for the broader LID addressing problem.

## Group metadata lifecycle

### Initial hydration

After the socket reaches `open`, the runtime calls `groupFetchAllParticipating()` once. It persists the returned map directly; it does not rely solely on the side effect of a `groups.update` event. After all returned groups are saved, it appends `group.bootstrap.complete`. On later reconnects, that marker prevents another full group-list fetch. `.groupinfo` in a private chat can await the same in-flight initial batch if the user runs it during startup; it does not create a second batch request.

### Incremental event handling

- `groups.upsert`: save newly added/full group metadata.
- `groups.update`: update subject, description, owner, restrictions, and other metadata fields in the existing record. If a group is unknown, a single lazy fetch may fill the missing record.
- `group-participants.update` with `add`, `promote`, `demote`, or `modify`: upsert/update those participants and index any verified PN numbers in `contact.jsonl`.
- `group-participants.update` with `remove` or `leave`: remove participants only from that group's participant list. Contact rows remain.
- A `remove` event containing the bot's verified PN/LID identity: append `group.delete` and remove the group from the active metadata Map. `contact.jsonl` is not altered.

### Avoiding repeated protocol queries

`ensureGroupMetadata()` returns immediately for a cached group. For an unknown group, it uses one in-flight Promise per group, plus `groupMetadata.fetchCooldownMs` (default 10 minutes), to prevent concurrent/repeated `groupMetadata()` calls. The initial batch is guarded by a durable bootstrap marker. The runtime never calls `groupMetadata()` on each incoming message for a group already in cache.

## Interactive command responses

The dispatcher no longer wraps plugin `m.reply()` calls. All command replies use the serializer text transport, which is readable and copyable on standard WhatsApp clients. `.menu`, `.owner`, and private-chat `.groupinfo` use text output and show command syntax explicitly. The legacy `ui.buttonsEnabled` state and `.buttons on/off/status` command remain persisted for compatibility, but neither setting can force native-flow transport globally. Native-flow helper APIs remain opt-in and must be validated against the target clients before use.


## Reply-driven group navigation

The `.groupinfo` private-chat screen uses `m.replyWithSession()` from the serializer. The helper sends a normal text message, takes the returned WhatsApp message ID, and registers a session against `(chat JID, screen message ID)`. A reply must quote that exact screen and come from the same sender who opened it. The dispatcher checks this session before AI detection; an invalid numeric input stays in the command lane and receives the valid options. A successful selection consumes that screen session before opening the next detail/page screen, preventing duplicate event delivery from repeating an action.

Sessions are held in process memory, default to a 10-minute TTL, and are not restored after restart. This is intentional for navigation state: cached group metadata remains durable in `group-metadata.jsonl`, while transient choices are regenerated by running `.groupinfo` again.
