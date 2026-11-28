# Menu, Message Test Lab, YouTube & Master Controls

## Serializer contract

Selectable menus must be built through the existing socket helper installed by `src/lib/serializ_simple.js`:

```js
sock
  .buttonBuilder()
  .setTitle(title)
  .setBody(body)
  .addSelection(selectionTitle)
  .makeSection(sectionTitle)
  .makeRow(header, title, description, commandId)
  .send(chat, { quoted: message });
```

Do not replace this with a hand-built `sendInteractive()` object. The repository's `ButtonBuilder` serializes the Native Flow selection, wraps it as an interactive message, and attaches the `biz/interactive/native_flow` node.

`serializ_simple.js` normalizes `interactiveResponseMessage` replies: `parseNativeFlowResponse()` provides `selectedId`, then the serializer writes that value to `m.buttonId` and `m.body`. The existing command dispatcher can therefore process IDs such as `.test select 1`, `.menu general 2`, and `.ytmp3 <url>` as ordinary commands.

## Main command menu

- `.menu` opens the main category selector through `ButtonBuilder`.
- The main menu exposes `.yts`, `.profile`, and `.website` as direct actions.
- Verified owners also receive direct `.test` Message Test Lab and `.master status` actions.
- `.menu general [page]` lists all general commands, including `yts` and its registered aliases (`ytsearch`, `ytmp3`, `ytmp4`, `ytm`, `ytmusic`, `ytplay`).
- Canonical command names take precedence over colliding aliases. The menu does not claim an alias that dispatch would resolve to another canonical plugin.

## Message Test Lab

`.test` opens the 16-suite catalog in two pages, all through `ButtonBuilder`:

1. Legacy buttonsMessage.
2. Legacy ListMessage.
3. Legacy TemplateMessage / hydrated template.
4. ButtonV2 wrapped as viewOnce with location header.
5. Image + ExternalAdReply.
6. Video, audio and document media pack.
7. Poll, event, location, contact and scheduled-call utility messages.
8. Native Flow core actions.
9. Native Flow image media header.
10. Galaxy Flow, catalog and address form.
11. Voice call and call permission request.
12. Commerce and payment test payloads (dummy values).
13. Extended CTA actions.
14. Carousel through the existing `CarouselBuilder`.
15. Storefront and collection messages.
16. AIRich response.

Payloads and media examples are supplied by local `assets/message-test/` fixtures. A selected test emits the actual test payload. Success IDs and errors are written to logs; no relay-progress summary is sent to the chat. Rendering and button behavior must still be checked on the target WhatsApp client.

## Master controls

- `.master warning off`: suspicious non-hard-blocked workloads continue without an interactive confirmation prompt and generate an audit entry. Statically hard-blocked commands remain denied.
- `.master warning compact|detailed|on`: restore warning and confirmation UI.
- `.master review off`: disable AI semantic assessment only; it does not set warning mode to off.
- `.master eval off`: disable the JavaScript eval runner.
- `.master group on|off|status`: allow or deny the verified owner from using Master console/runners in groups. The default is OFF; configure it in the owner's private chat. Non-owners remain denied.

Warning OFF deliberately removes an interactive safety checkpoint. It does not make eval safe or sandboxed.

## Separate local ports

Nexora Code Lab owns `127.0.0.1:8787`. Rental Dashboard API defaults to `127.0.0.1:8788` to prevent `EADDRINUSE`. Set `rentalApi.port` to `8788` in `config/runtime.json`; legacy `OCHA_RENTAL_API_PORT` overrides are supported only for compatibility.
