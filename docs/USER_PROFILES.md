# Nexora User Profiles

## Commands

- `.profile` / `.me` / `.level` / `.xp`: display the current sender's profile card and summary.
- `.aiset identity on/off`: allow or suppress public disclosure of creator and organization identity.

## XP and levels

A valid first contact on a new Asia/Jakarta calendar day grants base XP plus a daily bonus. Unique, meaningful contributions grant additional XP; repeated low-signal content does not farm XP. A 60-second award cooldown and durable message/content fingerprints prevent rapid farming and duplicate awards. There is no daily XP ceiling or level ceiling. Per-user profile writes are serialized. XP is stored as an arbitrary-precision integer string, beyond JavaScript safe-integer limits.

Cumulative XP required to enter level `L` is `50 * L * (L - 1)`. Rank milestones are Iron (1), Bronze (5), Silver (10), Gold (20), Platinum (35), Diamond (50), Mythic (75), Astral (150), Celestial (250), Sovereign (500), Eternal (1000), Paragon (1500), Nova (2500), Cosmic (5000), Apex (10000), Transcendent (25000), Nexus (50000), and Singularity (100000).

## Activity streaks and achievements

A current streak increases once when a user has an eligible interaction on a new consecutive Asia/Jakarta calendar day. Multiple interactions on the same day do not increase the streak. Missing a calendar day resets the current streak; the best streak is retained. Existing profiles without historical streak data are migrated conservatively and are not assigned a long streak retroactively.

Achievements are derived from aggregate totals, including first contact, conversation milestones, active-day milestones, streak milestones, and rank tiers. The profile card shows a capped selection of the latest earned milestones.

## Relationship role

Relationship role is an operational familiarity tier derived from total interactions, meaningful interactions, active days, tenure, and trust score: Pengunjung, Kenalan, Teman Ngobrol, Teman Akrab, Sahabat Digital, Mitra Tepercaya. A verified owner has the fixed role Owner & Creator. New contacts receive reserved but respectful replies. Only the verified owner in a private chat receives the warmer/affectionate persona; group interactions remain professional. XP/rank/trust are not access permissions, and the model is instructed not to claim human feelings.

## Stored data

Each user has a separate encrypted profile snapshot inside `data/roo/<sha256-user-id>/profile/`. It stores display name, XP, level, rank, aggregate interactions, active days, current/best streaks, daily XP counters, message IDs and content fingerprints used for durable award deduplication, greeting count, and broad communication-style counters. It does not store raw messages in the profile record. Full private conversation turns are archived separately in the same user’s encrypted monthly journal; model context retrieval is bounded and relevance-ranked.

## Public creator identity

Only these non-secret config values are exposed to the model: `bot.ownerName`, `bot.creatorName`, `bot.organization`, and `bot.publicCreatorDisclosure`. Default values are Arifi Razzaq and Razzaq Ventures. Owner verification remains a code-level PN check and cannot be changed by prompt text.
