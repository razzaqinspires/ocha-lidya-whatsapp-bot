# Command Registry Audit — Ocha Lidya v1.10.60

**Audit method:** static source descriptor scan of `src/plugins/**/*.js`; metadata fields are parsed from `export default` declarations. This is not a live dispatcher/ACIE/VPS snapshot.

## Summary

- Plugin JavaScript files scanned: **49**
- Command descriptors found: **48**
- Declared aliases: **89**
- Canonical + alias identifiers: **137**
- Static normalized collisions: **0**
- `menu: false` descriptors: **2**

No normalized source-level canonical-name or alias collision was found.

## Static descriptor inventory

| Command        | Aliases                                                            | Category  | Owner-only | Private-only | Hidden from menu | Source                              |
| -------------- | ------------------------------------------------------------------ | --------- | ---------: | -----------: | ---------------: | ----------------------------------- |
| `about`        | `botinfo`                                                          | general   |         no |           no |               no | `src/plugins/general/about.js`      |
| `acie`         | `contribengine`                                                    | owner     |        yes |          yes |               no | `src/plugins/owner/acie.js`         |
| `aimodels`     | `modelcatalog`, `modelcheck`                                       | owner     |        yes |           no |               no | `src/plugins/owner/aimodels.js`     |
| `aiset`        | `aiconfig`                                                         | owner     |        yes |           no |               no | `src/plugins/owner/aiset.js`        |
| `aistatus`     | `aihealth`                                                         | owner     |        yes |           no |               no | `src/plugins/owner/aistatus.js`     |
| `apikey`       | `keys`, `keymanager`                                               | owner     |        yes |           no |               no | `src/plugins/owner/apikey.js`       |
| `autopush`     | `gitpush`, `autogit`                                               | owner     |        yes |          yes |              yes | `src/plugins/owner/autopush.js`     |
| `buttons`      | `buttonmode`, `uibuttons`, `button`, `fullbutton`, `commandbutton` | owner     |        yes |          yes |               no | `src/plugins/owner/buttons.js`      |
| `chatnivo`     | —                                                                  | owner     |        yes |          yes |               no | `src/plugins/owner/chatnivo.js`     |
| `commandaudit` | `aliasaudit`, `commandconflicts`                                   | owner     |        yes |          yes |               no | `src/plugins/owner/commandaudit.js` |
| `config`       | `configuration`, `settings`                                        | owner     |        yes |          yes |               no | `src/plugins/owner/config.js`       |
| `createcmd`    | `makecmd`, `commandcreate`                                         | owner     |        yes |          yes |               no | `src/plugins/owner/createcmd.js`    |
| `dbsearch`     | `archivefind`                                                      | owner     |        yes |           no |               no | `src/plugins/owner/dbsearch.js`     |
| `dbstatus`     | `database`, `dbhealth`                                             | owner     |        yes |           no |               no | `src/plugins/owner/dbstatus.js`     |
| `features`     | `featurerequests`, `fiturreq`                                      | owner     |        yes |          yes |              yes | `src/plugins/owner/features.js`     |
| `groupadmin`   | `gadmin`, `grupadmin`                                              | general   |         no |           no |               no | `src/plugins/general/groupadmin.js` |
| `groupinfo`    | `gcinfo`, `grouplist`                                              | general   |         no |           no |               no | `src/plugins/general/groupinfo.js`  |
| `guard`        | `commandguard`, `antispam`                                         | owner     |        yes |          yes |               no | `src/plugins/owner/guard.js`        |
| `jid`          | `jidinfo`, `liddebug`                                              | developer |        yes |           no |               no | `src/plugins/owner/jid.js`          |
| `joingc`       | `joingroup`, `join-group`                                          | owner     |        yes |          yes |               no | `src/plugins/owner/joingc.js`       |
| `kernel`       | `kernelstatus`, `nadiweb`                                          | general   |         no |           no |               no | `src/plugins/general/kernel.js`     |
| `master`       | `masterconfig`                                                     | owner     |        yes |           no |               no | `src/plugins/owner/master.js`       |
| `memori`       | `memory`, `ingatan`, `arsipchat`                                   | general   |         no |           no |               no | `src/plugins/general/memori.js`     |
| `menu`         | `help`, `commands`                                                 | general   |         no |           no |               no | `src/plugins/general/menu.js`       |
| `mute`         | `groupmute`                                                        | owner     |        yes |           no |               no | `src/plugins/owner/mute.js`         |
| `nadi`         | `heartbeat`, `selfstate`                                           | owner     |        yes |          yes |               no | `src/plugins/owner/nadi.js`         |
| `nexora`       | `capability`, `aitools`                                            | owner     |        yes |          yes |               no | `src/plugins/owner/nexora.js`       |
| `owner`        | `creator`                                                          | general   |         no |           no |               no | `src/plugins/general/owner.js`      |
| `ping`         | `speed`, `latency`                                                 | general   |         no |           no |               no | `src/plugins/general/ping.js`       |
| `plugins`      | `pluginlist`                                                       | owner     |        yes |           no |               no | `src/plugins/owner/plugins.js`      |
| `profile`      | `me`, `level`, `xp`                                                | general   |         no |           no |               no | `src/plugins/general/profile.js`    |
| `project`      | `projects`, `repo`, `repository`                                   | developer |         no |           no |               no | `src/plugins/general/project.js`    |
| `react`        | `autoreact`, `reactions`                                           | owner     |        yes |          yes |               no | `src/plugins/owner/reactions.js`    |
| `reload`       | `reloadplugins`                                                    | owner     |        yes |           no |               no | `src/plugins/owner/reload.js`       |
| `rentals`      | `rentaladmin`, `sewaadmin`                                         | owner     |        yes |          yes |               no | `src/plugins/owner/rentals.js`      |
| `run`          | `execute`, `previewcode`                                           | developer |         no |           no |               no | `src/plugins/general/run.js`        |
| `runtime`      | `system`, `sysinfo`                                                | developer |         no |           no |               no | `src/plugins/general/runtime.js`    |
| `setbotname`   | `botname`                                                          | owner     |        yes |           no |               no | `src/plugins/owner/setbotname.js`   |
| `setmenu`      | `menuset`, `menuconfig`                                            | owner     |        yes |          yes |               no | `src/plugins/owner/setmenu.js`      |
| `setmode`      | `mode`                                                             | owner     |        yes |           no |               no | `src/plugins/owner/setmode.js`      |
| `setprefix`    | `prefix`                                                           | owner     |        yes |           no |               no | `src/plugins/owner/prefix.js`       |
| `sewa`         | `rent`, `paketsewa`                                                | general   |         no |           no |               no | `src/plugins/general/sewa.js`       |
| `sewaapi`      | `dashboardkey`, `webkey`                                           | general   |         no |           no |               no | `src/plugins/general/sewaapi.js`    |
| `tictactoe`    | `ttt`, `xo`                                                        | games     |         no |          yes |               no | `src/plugins/tictactoe.js`          |
| `website`      | `buatwebsite`, `webprofile`                                        | general   |         no |           no |               no | `src/plugins/general/website.js`    |
| `webverify`    | `websiteverify`                                                    | owner     |        yes |          yes |               no | `src/plugins/owner/webverify.js`    |
| `ytconfig`     | `youtubeconfig`                                                    | owner     |        yes |          yes |               no | `src/plugins/owner/ytconfig.js`     |
| `yts`          | `ytsearch`, `ytmp3`, `ytmp4`, `ytm`, `ytmusic`, `ytplay`           | general   |         no |           no |               no | `src/plugins/general/youtube.js`    |

## ChatNivo command security

- Canonical command: `.chatnivo`; aliases: none.
- Descriptor: `ownerOnly: true`, `privateOnly: true`; handler also checks the configured owner identity and rejects group chat.
- Actions: `status`, `models`, `model <id>`, `fallback on|off`, and `export`.
- Export is an explicit owner action. Output is written only to `data/private/chatnivo-exports`; exported conversation data is not returned in WhatsApp messages.

## Limits

- ACIE-generated commands and private-runtime commands are not included in this static public plugin scan. Loader-time command collision checks still apply when those registries are loaded.
- `menu: false` hides a command from menus but does not remove it from dispatch.
- This report does not prove that every plugin imported successfully on the VPS. Re-run the owner `.commandaudit scan` after deployment.
