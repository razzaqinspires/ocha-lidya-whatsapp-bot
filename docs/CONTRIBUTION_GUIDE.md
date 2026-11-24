# Contribution Guide

## Before intake

Obtain the contributor's identity, the project/name, license or permission grant, attribution wording, expected runtime and any restrictions. Do not infer permission from receiving a file. If details are missing, ACIE records `PENDING_INFORMATION` and keeps the provider quarantined.

Prepare a complete directory or ZIP outside the Ocha repository. Keep the package manifest, lockfile, source files, comments, dotfiles and embedded credentials exactly as received. Do not edit the package to make it easier to intake.

## Intake command

```bash
npm run acie:intake -- \
  --source /srv/incoming/pinterest-module.zip \
  --contributor-id contributor-001 \
  --contributor-name "Contributor Name" \
  --name pinterest-downloader \
  --project-id ocha-lidya-bot \
  --license "MIT" \
  --attribution "Original implementation by Contributor Name"
```

Use a stable contributor ID and contribution name. Each repeated intake under the same contributor/name pair creates the next immutable version. If the contributor supplies no license, omit `--license`; do not assume MIT or an unrestricted license.

## After intake

- Check `.acie contribution list` and `.acie contribution inspect <id>`.
- Verify `.acie contribution verify <id>` is `verified`.
- Read `.acie security`, `.acie dependencies`, `.acie compatibility` and `.acie commands`.
- Resolve license/attribution and command collisions.
- Request adapter/runtime validation in a dedicated sandbox before any activation.

## Re-submissions

A changed contribution is a new version. Do not replace `versions/vN/original/`. Use `.acie contribution history <id>` to review prior versions. Version activation/rollback is not enabled in this foundation.
