# Changelog

## Unreleased

## v0.3.0-beta - 2026-10-08

- Add localized **End quiz** buttons to topic and random polls, with Manage Server permission checks, private feedback, duplicate-close protection and finalized-vote scoring. Keep `/poll end` as a fallback.

- Remove `questions_per_run`: each topic run publishes exactly one question.
- Share one daily run per topic between manual commands and scheduled generation; an early manual run replaces that day's scheduled run.
- Limit random quizzes to three per server per calendar day, with persistent concurrency-safe reservations.
- Add `duration_hours:1-24` for topic configuration, defaults, manual runs and random quizzes; preserve 24 hours for existing topics.
- Use configurable `QUIZ_TIMEZONE` (default `Europe/Warsaw`) for daily limits and scheduled times.

## v0.2.0-beta - 2026-10-07

### Security

- Run the production bot as a non-root user with a read-only filesystem, dropped capabilities and no-new-privileges; keep one stopped rollback version.
- Add count-only server log/access auditing and private deployment-log permissions.
- Add local OCR, QR and metadata checks for current/historical images, visual-review fingerprints and metadata-free publication copies; block unchecked publication.

- Use allowlisted error summaries for scheduled generation, registration, AI failures and scoring; omit private topic names from operational logs.
- Add checksum-verified Gitleaks scanning before pushes, in CI and before direct deployment.
- Replace the literal production database endpoint in tests with explicit test-only host, database name and confirmation settings.
- Pin Prisma client and CLI to 6.19.3 and override its deepmerge-ts dependency to patched 8.0.0, with regression checks.

### Added

- Grouped command-help cards for `/help` and `/dilemma help`, with concise descriptions in six languages.
- Score profile and leaderboard cards without duplicate text or a rules paragraph; player display names replace raw mentions in profile titles.

- Server-specific quiz scores: easy 1, medium 2 and hard 3 points for correct answers.
- Accuracy, current and best correct-answer streaks, and top-ten server leaderboards.
- `/score profile`, `/score leaderboard` and confirmed self-service `/score forget`.
- Finalized-vote pagination, bot filtering and actual Discord answer ID mapping.
- Atomic, idempotent settlements with retry scheduling and restart recovery.
- Chronological streak recalculation when a poll is processed out of order.
- Scoring unit tests and isolated PostgreSQL tests for concurrency, rollback, server isolation and privacy deletion.
- Privacy policy describing stored final votes, score visibility and deletion.

### Fixed

- Reject generated correct-answer indexes that do not exist in the options.
- Restrict poll closing to recorded Dilemma quizzes in the current server and channel.

## v0.1.2-alpha - 2026-10-06

### Added

- Easy, medium and hard difficulty for random quizzes, saved topics and scheduled generation.
- Server default difficulty; existing topics retain their own settings and migrate to medium.
- Difficulty labels on polls and topic summaries.
- Localized help, progress and confirmations with Dilemma-style kaomoji in six languages.
- Clear localized validation, permission, quota and timeout errors.
- Automated feature tests and additive migration checks on SQLite and an isolated PostgreSQL branch.

### Fixed

- Acknowledge command interactions before database work.
- Require Manage Server permission for the onboarding language selector.
- Use direct Neon connections for migrations without changing the bot's pooled connection.
- Treat server language as global for existing and new topics, manual runs, scheduled questions and result labels.
- Preserve topic difficulty and question count when changing the global language.

### Known limitations

- Free AI provider limits still apply; questions are not guaranteed to arrive within a fixed time.
- Dependency audit reports a high-severity advisory in the Prisma CLI dependency chain. It remains pending a separately tested dependency update.

## v0.1.1-alpha - 2026-10-06

### Fixed

- Bound AI generation and queue waiting to a configurable deadline, defaulting to 60 seconds.
- Disable hidden SDK retries to prevent overlapping retry budgets.
- Acknowledge random quiz and language-setting interactions before database operations.
- End pending random quiz replies with a clear error when generation fails or times out.
- Normalize answer options consistently before validation.
- Use OpenRouter chat completions for quiz generation.
- Include OpenSSL and CA certificates in Docker images for Prisma compatibility.
- Normalize Docker environment files without exposing credentials.

### Added

- PostgreSQL and Neon production deployment setup.
- Oracle Docker deployment instructions with timezone, restart policy and log rotation.
- AI smoke check and automated timeout, queue recovery and normalization tests.

### Verification

- TypeScript checks and build passed.
- Automated AI generation tests passed.
- Live AI smoke check on Oracle returned a valid Polish quiz in approximately 13 seconds.
- Random quiz publication on Discord was confirmed by the user.

Question difficulty remains planned for the next release and is not included in this version.
