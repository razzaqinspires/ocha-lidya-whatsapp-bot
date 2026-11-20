# Nexora User Profiles

## Commands

- `.profile` / `.me` / `.level` / `.xp`: display the current sender's profile.
- `.aiset identity on/off`: allow or suppress public disclosure of creator and organization identity.

## XP and levels

Each eligible AI interaction grants 5 XP. The first interaction on a new Asia/Jakarta calendar day grants an additional 10 XP. Daily XP is capped at 100. Message IDs are deduplicated to prevent repeated processing from awarding XP twice.

Cumulative XP required to enter level `L` is `50 * L * (L - 1)`. Rank milestones are Iron (1), Bronze (5), Silver (10), Gold (20), Platinum (35), Diamond (50), and Mythic (75).

## Relationship role

Relationship role is a non-emotional familiarity tier derived from aggregate interactions and active days: Pengunjung, Kenalan, Teman Ngobrol, Teman Akrab, Sahabat Digital. A verified owner has the fixed role Owner & Creator. The model is instructed not to claim human feelings.

## Stored data

Each user has a separate `ai.user.profile` record in the append-only JSONL repository. It stores display name, XP, level, rank, aggregate interactions, active days, daily XP counters, bounded recent message IDs, greeting count, and broad communication-style counters. It does not store raw messages in the profile record.

## Public creator identity

Only these non-secret config values are exposed to the model: `bot.ownerName`, `bot.creatorName`, `bot.organization`, and `bot.publicCreatorDisclosure`. Default values are Arifi Razzaq and Razzaq Ventures. Owner verification remains a code-level PN check and cannot be changed by prompt text.
