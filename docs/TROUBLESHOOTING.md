# Troubleshooting

## Intake fails: source path inside repository

Move the received directory/ZIP to a staging location outside the Ocha repository. ACIE rejects sources under the repository root to prevent accidental self-intake.

## Intake fails: symlink or special entry

Ask the contributor to provide regular files in a directory/ZIP without symlinks, device nodes or other special file entries. Do not follow links into host filesystems.

## ZIP intake says `yauzl` missing

Install the package dependencies on the VPS with `npm install --no-audit --no-fund`. `yauzl` is already declared in `package.json`.

## Integrity is compromised

Stop activation. Keep the original version as-is, record the report and compare against the contributor's exact original bundle. A corrected submission must be a new version.

## No capability/command drafts found

Discovery is intentionally conservative and heuristic. Review the static analysis and function/export candidates. Do not invent capability mappings; add a separately reviewed capability rule if evidence supports it.

## Provider enable is refused

Check `.acie provider inspect <id>`. License review, adapter validation, sandbox approval, owner authorization and output-contract verification are all mandatory. This foundation does not include a production sandbox, so providers are expected to remain quarantined.

## No generated command in `.menu`

Draft commands are not active plugins. The existing menu only lists commands loaded through the Ocha plugin registry. Do not copy original source into `src/plugins/` to force visibility.
