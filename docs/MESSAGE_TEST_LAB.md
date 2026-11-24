# Ocha Message Test Lab and Automatic Reactions

Version: 1.10.40

## Message test lab

The test lab is restricted to the verified owner in a private chat. Send `.test` and select a test from the native-flow list. No media URL, poll question, button label, caption, or external thumbnail needs to be typed manually.

Available test selections:

- **Full Button Suite** — five native-flow pages, quick replies, list selection, legacy buttons, hydrated templates.
- **Native Flow All** — all five native-flow pages.
- **Quick Reply & List** — quick replies and single-select list.
- **Poll Message** — a poll with a predefined question and options.
- **Carousel** — two cards using bundled local images.
- **Media Pack** — image, video, audio, PDF, sticker, view-once and PTV fixtures.
- **Legacy & Hydrated** — legacy `buttonsMessage` and hydrated template.
- **Location, Contact & Event** — synthetic location, contact and event.
- **AI Rich Message** — predefined rich text and code block.
- **Run Everything** — the complete supported fixture set.

Local asset directory:

```text
assets/message-test/
```

Included assets:

```text
sample-image.png
carousel-01.png
carousel-02.png
sample-sticker.webp
sample-audio.wav
sample-document.pdf
sample-video.mp4
README.md
```

The assets are synthetic fixtures and must not be replaced with private user media. The media pack reads files from this directory relative to the bot's working directory.

Successful tests do not send a chat-side summary. Only the actual test payloads appear in the chat. If the transport returns message IDs, they are written to the runtime log. Exceptions are logged with their test ID. A WhatsApp relay result or message ID is not proof that every receiver client renders or supports that message format; verify the resulting messages on the target WhatsApp clients.

Interactive callbacks use `.test response ...` and are logged without sending an extra confirmation message.

## Automatic reactions

Automatic reactions are disabled by default. A verified owner must open the private `.react` menu or run one of these commands:

```text
.react on
.react off
.react status
```

When enabled:

- Plugin command: `⏳` while dispatching, then `✅` when the dispatcher accepts/completes the command.
- AI conversation: `💭` while the AI response is being generated, then `✅` when processing returns successfully.
- Rejected or failed dispatch: `❌`.

The final reaction updates the same incoming message. Reaction delivery is best-effort; if a WhatsApp client/session rejects the reaction, normal command or AI processing is not blocked. The setting is persisted in app config and can only be changed through the owner-only private `.react` plugin.

## Quoted AI context

The serializer looks for WhatsApp quote context across direct message content and common nested wrappers. The AI input includes the text and type of the quoted message. Generic greeting-only provider responses are suppressed on quoted turns. For the example “Coba lihat sirkuitmu”, the fallback distinguishes the software runtime from physical hardware and points to checks that the bot can actually perform. Quote diagnostics record only IDs, type and character counts, not private message content.
