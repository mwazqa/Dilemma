# Changelog

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
