# Command Registry Audit — Ocha Lidya v1.10.58

**Audit method:** static descriptor scan of `src/plugins/**/*.js` using the exported `name`, `aliases`, `category`, `ownerOnly`, `privateOnly`, and `menu: false` fields. This is not a live runtime registry snapshot.

## Result

- Plugin source files scanned: **48**
- Exported plugin descriptors discovered: **47** canonical command names
- Declared aliases: **89**
- Normalized canonical + alias identifiers: **136**
- Static canonical/alias collisions: **0**
- Descriptors hidden from the menu by `menu: false`: **2**

No normalized canonical-name or alias collision was found in the scanned public plugin source.

## Static descriptor inventory

| Canonical command | Aliases                                                            | Category  | Owner-only | Private-only | In menu | Source                              |
| ----------------- | ------------------------------------------------------------------ | --------- | ---------: | -----------: | ------: | ----------------------------------- |
| `about`           | `botinfo`                                                          | general   |      false |        false |     yes | `src/plugins/general/about.js`      |
| `groupadmin`      | `gadmin`, `grupadmin`                                              | general   |      false |        false |     yes | `src/plugins/general/groupadmin.js` |
| `groupinfo`       | `gcinfo`, `grouplist`                                              | general   |      false |        false |     yes | `src/plugins/general/groupinfo.js`  |
| `kernel`          | `kernelstatus`, `nadiweb`                                          | general   |      false |        false |     yes | `src/plugins/general/kernel.js`     |
| `memori`          | `memory`, `ingatan`, `arsipchat`                                   | general   |      false |        false |     yes | `src/plugins/general/memori.js`     |
| `menu`            | `help`, `commands`                                                 | general   |      false |        false |     yes | `src/plugins/general/menu.js`       |
| `owner`           | `creator`                                                          | general   |      false |        false |     yes | `src/plugins/general/owner.js`      |
| `ping`            | `speed`, `latency`                                                 | general   |      false |        false |     yes | `src/plugins/general/ping.js`       |
| `profile`         | `me`, `level`, `xp`                                                | general   |      false |        false |     yes | `src/plugins/general/profile.js`    |
| `project`         | `projects`, `repo`, `repository`                                   | developer |      false |        false |     yes | `src/plugins/general/project.js`    |
| `run`             | `execute`, `previewcode`                                           | developer |      false |        false |     yes | `src/plugins/general/run.js`        |
| `runtime`         | `system`, `sysinfo`                                                | developer |      false |        false |     yes | `src/plugins/general/runtime.js`    |
| `sewa`            | `rent`, `paketsewa`                                                | general   |      false |        false |     yes | `src/plugins/general/sewa.js`       |
| `sewaapi`         | `dashboardkey`, `webkey`                                           | general   |      false |        false |     yes | `src/plugins/general/sewaapi.js`    |
| `website`         | `buatwebsite`, `webprofile`                                        | general   |      false |        false |     yes | `src/plugins/general/website.js`    |
| `yts`             | `ytsearch`, `ytmp3`, `ytmp4`, `ytm`, `ytmusic`, `ytplay`           | general   |      false |        false |     yes | `src/plugins/general/youtube.js`    |
| `acie`            | `contribengine`                                                    | owner     |       true |         true |     yes | `src/plugins/owner/acie.js`         |
| `aimodels`        | `modelcatalog`, `modelcheck`                                       | owner     |       true |        false |     yes | `src/plugins/owner/aimodels.js`     |
| `aiset`           | `aiconfig`                                                         | owner     |       true |        false |     yes | `src/plugins/owner/aiset.js`        |
| `aistatus`        | `aihealth`                                                         | owner     |       true |        false |     yes | `src/plugins/owner/aistatus.js`     |
| `apikey`          | `keys`, `keymanager`                                               | owner     |       true |        false |     yes | `src/plugins/owner/apikey.js`       |
| `autopush`        | `gitpush`, `autogit`                                               | owner     |       true |         true |      no | `src/plugins/owner/autopush.js`     |
| `buttons`         | `buttonmode`, `uibuttons`, `button`, `fullbutton`, `commandbutton` | owner     |       true |         true |     yes | `src/plugins/owner/buttons.js`      |
| `commandaudit`    | `aliasaudit`, `commandconflicts`                                   | owner     |       true |         true |     yes | `src/plugins/owner/commandaudit.js` |
| `config`          | `configuration`, `settings`                                        | owner     |       true |         true |     yes | `src/plugins/owner/config.js`       |
| `createcmd`       | `makecmd`, `commandcreate`                                         | owner     |       true |         true |     yes | `src/plugins/owner/createcmd.js`    |
| `dbsearch`        | `archivefind`                                                      | owner     |       true |        false |     yes | `src/plugins/owner/dbsearch.js`     |
| `dbstatus`        | `database`, `dbhealth`                                             | owner     |       true |        false |     yes | `src/plugins/owner/dbstatus.js`     |
| `features`        | `featurerequests`, `fiturreq`                                      | owner     |       true |         true |      no | `src/plugins/owner/features.js`     |
| `guard`           | `commandguard`, `antispam`                                         | owner     |       true |         true |     yes | `src/plugins/owner/guard.js`        |
| `jid`             | `jidinfo`, `liddebug`                                              | developer |       true |        false |     yes | `src/plugins/owner/jid.js`          |
| `joingc`          | `joingroup`, `join-group`                                          | owner     |       true |         true |     yes | `src/plugins/owner/joingc.js`       |
| `master`          | `masterconfig`                                                     | owner     |       true |        false |     yes | `src/plugins/owner/master.js`       |
| `mute`            | `groupmute`                                                        | owner     |       true |        false |     yes | `src/plugins/owner/mute.js`         |
| `nadi`            | `heartbeat`, `selfstate`                                           | owner     |       true |         true |     yes | `src/plugins/owner/nadi.js`         |
| `nexora`          | `capability`, `aitools`                                            | owner     |       true |         true |     yes | `src/plugins/owner/nexora.js`       |
| `plugins`         | `pluginlist`                                                       | owner     |       true |        false |     yes | `src/plugins/owner/plugins.js`      |
| `setprefix`       | `prefix`                                                           | owner     |       true |        false |     yes | `src/plugins/owner/prefix.js`       |
| `react`           | `autoreact`, `reactions`                                           | owner     |       true |         true |     yes | `src/plugins/owner/reactions.js`    |
| `reload`          | `reloadplugins`                                                    | owner     |       true |        false |     yes | `src/plugins/owner/reload.js`       |
| `rentals`         | `rentaladmin`, `sewaadmin`                                         | owner     |       true |         true |     yes | `src/plugins/owner/rentals.js`      |
| `setbotname`      | `botname`                                                          | owner     |       true |        false |     yes | `src/plugins/owner/setbotname.js`   |
| `setmenu`         | `menuset`, `menuconfig`                                            | owner     |       true |         true |     yes | `src/plugins/owner/setmenu.js`      |
| `setmode`         | `mode`                                                             | owner     |       true |        false |     yes | `src/plugins/owner/setmode.js`      |
| `webverify`       | `websiteverify`                                                    | owner     |       true |         true |     yes | `src/plugins/owner/webverify.js`    |
| `ytconfig`        | `youtubeconfig`                                                    | owner     |       true |         true |     yes | `src/plugins/owner/ytconfig.js`     |
| `tictactoe`       | `ttt`, `xo`                                                        | games     |      false |         true |     yes | `src/plugins/tictactoe.js`          |

## `.setmenu` collision and security review

The menu settings command remains `setmenu` with aliases `menuset` and `menuconfig`. All three identifiers are unique in the static inventory. Its source descriptor has `ownerOnly: true` and `privateOnly: true`; the handler additionally verifies the sender against the configured owner and rejects group chats before calling `updateConfig`. It does not register or create command aliases dynamically.

## Runtime limits

- ACIE-generated commands and private-runtime `.test` are outside this static public descriptor scan. The local live VPS registry was not available in this build, so runtime command counts and dynamic collision status are not claimed.
- `menu: false` hides a command from the public menu; it does not remove the command from dispatch.
- The menu uses `listPlugins()` at request time. The descriptor inventory above is a static check of the source tree, not proof that every plugin imported successfully in the live process.
- Run `.commandaudit scan` on the connected Ocha instance after deployment to verify the runtime registry, private runtime, and eligible ACIE virtual command set.
