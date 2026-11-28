# Ocha Lidya v1.10.58 — Menu Design and Setmenu Integration

**Release scope:** Ocha Node.js source snapshot based on local v1.10.57 operator ZIP. The independent Artificial Consciousness Component remains v2.1.1; its runtime source is unchanged, and only the paired `compatibleOchaVersion` metadata advances to Ocha v1.10.58.

## Source reference

The supplied `whiskay-bot.zip` was extracted and inspected without executing its code. The relevant Whiskay source/documentation was `src/plugins/general/menu.js`, `src/plugins/general/setmenu.js`, `src/lib/menu-settings.js`, `docs/SETMENU-QUOTED-CARD-TESTER.md`, and the menu sections of `README.md`. Only supported menu presentation concepts and the owner setmenu workflow were adapted.

## Changes

- Add 16 menu templates and 12 readable Unicode font presets to `src/core/menu-renderer.js`.
- Add menu sorting modes `category`, `az`, and `za`; spacing `0`–`3`; independent top/bottom border controls; and description visibility.
- Keep canonical command names and aliases sourced from the live Ocha plugin registry. Executable command identifiers remain plain ASCII in rendered text.
- Upgrade `.setmenu` to an interactive owner settings directory with text-command fallback. Keep aliases `menuset` and `menuconfig`, owner-only permission, and private-chat-only restriction.
- Persist preferences through the existing Ocha config event store; migrate config schema to v38 while preserving previous `showDescriptions` and `pagination` values.
- Preserve the existing native-flow menu and banner fallback. Native-flow category pages show at most seven command rows plus navigation; the `pages` and `limit` options configure text fallback pagination only. Description visibility is applied to both native Flow row details and text output.

## Explicitly not ported

Whiskay runtime dependencies and persistence, energy/profile/RPG/economy/leaderboard widgets, command-hit counters, custom menu image uploads, image canvas generation, randomization of unrelated profile defaults, quote experiments, and unrelated Whiskay commands were not moved. No Whiskay source file was modified.

## Command contract

- `.menu` / `.help` / `.commands`: display the Ocha live command menu.
- `.setmenu`: open the interactive design settings list.
- `.setmenu template <name>`: select one of 16 themes.
- `.setmenu font <name>`: select one of 12 supported font styles.
- `.setmenu order <category|az|za>`: choose command ordering.
- `.setmenu descriptions <on|off>`; `.setmenu pages <on|off>`.
- `.setmenu limit <10-200>`; `.setmenu spacing <0-3>`.
- `.setmenu border <top|bottom> <on|off>`; `.setmenu status`; `.setmenu reset`.

`.setmenu` is global owner configuration and rejects group chats. The dispatcher also enforces the plugin's owner-only policy; the plugin repeats source-identity verification before mutating config.

## Validation completed

- Menu renderer, native-flow menu, `.setmenu`, config migration and plugin-inventory focused tests: **17/17 passed**.
- Broader Ocha regression: **107 test files, 423 tests, 422 passed, 0 failed, 1 skipped**. The one skip is the private serializer/feature-load test because the Baileys peer dependency is not installed in this source workspace. `test/website-preview-gateway.test.js` was excluded after full-suite attempts did not terminate in this environment while managing its Quick Tunnel child process; gateway behavior is therefore not marked tested in this release.
- Environment inventory tests: **6/6 passed** after rebuilding the generated inventory using the declared Acorn 8.15.0 parser. The report covers 325 JavaScript files, 3 shell files, 59 environment names, 272 JavaScript access sites, 9 shell expansions and 7 dotenv load/reload sites. Thirteen unresolved computed reads are test-only; no production computed access remains unresolved. `.env` values were not read.
- JavaScript syntax inventory: **306 files passed**. Documentation validator: **87 Markdown files**, all local links resolved. Publication audit passed; no private-source fingerprint or credential pattern was detected in eligible public paths.
- Four immutable Ocha private-runtime source modules and their retained receipts passed SHA-256 integrity verification. The private package loader integration test itself is skipped without Baileys; manifest integrity verification passed.
- AC v2.1.1 Python compile passed; `selftest.py` **6/6**, `test_prime.py` **10/10**, and the isolation/bridge suite **5/5** passed. The AC runtime source is unchanged; only its paired compatibility marker was advanced to Ocha v1.10.58.
- Prettier was not run because local project dependencies are not installed. The declared Acorn parser was temporarily made available only for validation and was not bundled. The operator ZIP excludes `node_modules` and `.env`.
- No live WhatsApp account or VPS was connected. Native-flow transport is covered by mocks and structural tests, not a live-device test. No Git metadata is present in the extracted Ocha source, so no commit, push, or GitHub synchronization is claimed.

## Artificial Consciousness review

AC v2.1.1 was reviewed for NADI heartbeat, INTEROCEPTION, RASA, NEURO, KEHENDAK, MIMPI, DIRI, PANGGUNG, metrics/memory, and the HTTP sidecar contract. This UI-only menu revision does not change AC state, algorithms, lifecycle, API, or persistence. AC version remains v2.1.1 and its Python runtime source is unchanged; only `OCHA_COMPONENT_RELEASE.json` paired compatibility metadata is updated to 1.10.58.
