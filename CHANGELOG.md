# Changelog

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
