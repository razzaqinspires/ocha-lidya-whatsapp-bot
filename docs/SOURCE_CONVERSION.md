# Source conversion and provenance

The following user-provided source files were converted into native ESM modules under `src/lib/`. Function bodies, class bodies, constants, and export-object keys/aliases were retained. Changes are limited to module loading/export syntax and the explicitly documented LID/PN safety enhancement in `serializ_simple.js`.

| Source | Original bytes | Original lines | ESM bytes | ESM lines | Original SHA-256 |
|---|---:|---:|---:|---:|---|
| `freply.js` | 52,291 | 1,721 | 52,319 | 1,723 | `b9ac57c10c75b351154bf988dc71cb1794e5556d83daa0e69ec0639d875883b2` |
| `serializ_simple.js` | 56,806 | 1,556 | 57,941 | 1,581 | `7a33506875128b9b7e9fa6141f223b547a0de58f906a39547196c3610a766652` |
| `helpers.js` | 49,539 | 1,753 | 49,667 | 1,757 | `ad89348347b3972f05f95608808187551b953df77b529a7aff32006ed09bbdee` |

## Conversion notes

- `freply.js`: CommonJS crypto import changed to `node:crypto`; original export object retained as ESM default export.
- `helpers.js`: Baileys imports changed to `@whiskeysockets/baileys`; optional `sharp` remains optional through ESM dynamic import; original export object retained.
- `serializ_simple.js`: Baileys imports changed to ESM; helper modules use ESM default imports; optional `callMusic.js` is loaded through an ESM dynamic import at module initialization to preserve the original synchronous getter API. Original export object retained.
- LID safety enhancement: `toJid()` now preserves `@lid` JIDs rather than converting the opaque LID digits into a fabricated PN JID. Mapping cache now consumes `senderPn`, `remoteJidAlt`, `participantAlt`, and Baileys `signalRepository.lidMapping.getPNForLID()` when available.

The original uploaded files are not modified.
