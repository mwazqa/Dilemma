# Dilemma

International AI-powered Discord quiz bot.

Dilemma lets Discord communities configure quiz topics and daily question limits, then answer AI-generated multiple-choice questions through Discord polls and slash commands.

## Current status

Current MVP:

Latest release: `v0.2.0-beta`. See [CHANGELOG.md](CHANGELOG.md).

- TypeScript + Node.js 22
- Discord bot with `/dilemma`, `/help`, `/settings`, `/poll` and `/ping`
- AI-generated questions, options, facts and context-aware emoji
- OpenRouter support with configurable model
- Custom answer options or AI-generated options
- Topic intervals, questions per run and fixed local generation time
- Automatic scheduled generation
- Immediate poll closing with correct answer and fact
- SQLite + Prisma persistence for local development
- PostgreSQL + Neon persistence for production
- Server language onboarding when bot joins a guild
- Easy, medium and hard question difficulty for random quizzes, saved topics and scheduled generation
- Localized help and Dilemma-style command feedback in English, Polish, German, Spanish, French and Japanese
- Server-specific points, answer accuracy, correct-answer streaks and leaderboards

## Setup

Before pushing code, run `npm run security:setup` once to install the checksum-verified Gitleaks scanner and local pre-push hook. Use `npm run security:scan` to scan history and current publication candidates. The scanner blocks pushes when unavailable or when a scan fails; it does not print secret values. Hooks can be bypassed, so keep GitHub push protection enabled.

PostgreSQL tests require `TEST_DATABASE_CONFIRMED=true`, `EXPECTED_TEST_HOST` and `EXPECTED_TEST_DATABASE` matching a separately provisioned test database. Never use production credentials for these tests.

Requirements: Node.js 22+ and a Discord application/bot.

1. Run npm install.
2. Copy .env.example to .env.
3. Fill in Discord and OpenRouter credentials. Keep `DATABASE_URL="file:./dev.db"` for local development.
4. Run `npm run db:generate`.
5. Run `npm run db:migrate -- --name init`.
6. Run `npm run test:db:fresh` to verify migrations on a clean SQLite database.
7. Set `DISCORD_REGISTER_GLOBAL=true` for production, then run `npm run register`.
8. Run `npm run dev`.

Required variables:

- DISCORD_TOKEN
- DISCORD_CLIENT_ID
- DISCORD_GUILD_ID during development
- DISCORD_REGISTER_GLOBAL, set `true` for global command registration
- `AI_PROVIDER=openrouter`
- OPENROUTER_API_KEY
- OPENROUTER_MODEL, default: `nvidia/nemotron-3-super-120b-a12b:free`. Nemotron 3 Super requests use JSON mode with reasoning disabled. Free-provider rate limits still apply.
- DATABASE_URL, default: `file:./dev.db`

Never commit .env or bot/API keys.

## Commands

- `/dilemma create` - create a topic with optional `difficulty:easy|medium|hard`
- `/dilemma configure` - configure interval, question count, generation time or difficulty
- `/dilemma run` - generate questions immediately
- `/dilemma random option_count:2-4 difficulty:easy|medium|hard` - generate one random dilemma without a saved topic or topic counter; difficulty is optional
- `/dilemma list` - list topics
- `/dilemma enable`, `/dilemma disable`, `/dilemma rename`, `/dilemma delete`
- `/dilemma help` or `/help` - show help
- `/settings` - set server language and defaults
- `/poll end` - end a poll and publish its result
- `/score profile user:optional` - show points, accuracy, current and best correct-answer streak
- `/score leaderboard` - show the server's top ten players
- `/score forget confirm:true` - permanently delete your stored answers and score on the current server

Omitted difficulty uses the server default for random quizzes and new topics. Existing topics keep their saved level. `/settings defaults` can set a new default without changing existing topics. Existing data migrates to medium.

`/settings language` sets one global language for the server. It applies to existing and new topics, manual runs, random quizzes, scheduled generation and command feedback. Previously published questions and explanations are not retroactively translated. Custom answer options remain exactly as provided.

## Production notes

- Run the bot continuously. Automatic generation works only while the process is online.
- Use a persistent PostgreSQL database for production. SQLite is intended for local development.
- For PostgreSQL: set `DATABASE_URL`, run `npm run db:generate:postgres`, then `npm run db:migrate:postgres`.
- PostgreSQL migrations use `DATABASE_URL_UNPOOLED` when supplied, or derive the direct endpoint from a Neon pooled URL. The running bot keeps its original connection URL.
- Recommended free hosting: Oracle Cloud Always Free VM for the bot and Neon Free for PostgreSQL. See [DEPLOYMENT.md](DEPLOYMENT.md).
- Vercel is suitable for a future web dashboard, not for the always-on Discord bot process.
- Global Discord commands can take up to one hour to appear. Guild commands update faster during development.
- Never commit `.env`, Discord tokens or AI API keys.

## Roadmap

### Implemented in v0.1.2-alpha

- Add selectable question difficulty: easy, medium and hard.
- Apply the selected difficulty to random questions and saved topics, including scheduled generation.
- Pass the difficulty to the AI prompt and display it with each quiz.
- Preserve existing topic settings when introducing the new difficulty field.
- Give command feedback a consistent Dilemma uwu voice: warm, playful wording with occasional kaomoji.
- Cover success confirmations, progress messages, validation errors, permission errors and AI timeouts, localized to the server language.
- Keep errors and security warnings clear and actionable, with restrained styling. Preserve exact command names and technical details.

### Implemented in v0.2.0-beta

- User scores, correct-answer streaks and server leaderboards
- Final-vote scoring with atomic, idempotent settlements and restart recovery
- Self-service deletion of stored answers and scores

The beta marks the first release with working points, streaks and leaderboards. `v1.0.0` follows live poll validation and community feedback.

### Future releases

1. More languages beyond the six currently supported

## Scoring

Correct answers earn 1 point on easy, 2 on medium and 3 on hard. Wrong answers earn zero and reset the correct-answer streak. Not voting does not affect a streak. Streak order follows poll finish times, not background retry order. Equal finish times use message ID order for a stable tie-break.

Only new polls created after scoring is enabled count. Existing quiz history is preserved without retroactive awards. Scores are calculated after Discord finalizes a closed poll; the bot checks every minute and retries unavailable polls. The bot must have View Channel and Read Message History permissions for scored polls. No privileged Discord intent is required for voter retrieval.

`/poll end` can close a quiz early. Vote changes before closing are reflected in the final vote. Bot votes are excluded. Scores and leaderboards are isolated per server. Tied leaderboard scores are ordered by correct answers and then user ID. Score responses do not ping players.

Deleting your answers and score is permanent. Already scored polls are not rescored after deletion, but pending polls and future votes can create new records. See [Privacy Policy](PRIVACY_POLICY.md).

## Publication privacy checks

Run `npm run security:setup` and `npm run security:images:setup` once. The latter
downloads checksum-verified English/Polish OCR models from a pinned official
revision. Images and recognized text stay local; no OCR service receives them.

`npm run security:publication` checks Git history/current candidates for secrets,
then checks current and historical raster images for metadata, QR codes and
sensitive OCR text. The local pre-push hook and prepared CI workflow use these
controls. A failed or unavailable scanner blocks publication. Hooks are bypassable.

PNG/JPEG/WebP single-frame images are supported; other formats require manual
conversion and review. Every image also requires visual review, recorded by its
SHA256 in `image-publication-reviews.json`. Changed bytes invalidate that approval.
Do not approve solely because OCR reports no finding. Inspect names, identifiers,
small text, screenshots, badges and alpha-hidden content. These checks are not a
steganography detector or a guarantee against all disclosures.

`npm run security:images:prepare -- <local-image>` creates a flattened,
metadata-free PNG copy under the ignored `.tools/image-publication` directory.
It preserves the original and refuses detected QR codes or sensitive text.
Review the copy before using it. For visible private data, use an opaque redaction
or crop, then rerun the checks; do not rely on blur or a translucent overlay.

`npm run security:production` audits production logs and host controls without
printing raw logs, addresses, account names or credentials. Cloud account access,
provider snapshots, historical backups and database role design require separate
verification. See `SECURITY_REVIEW.md` for current scope and limitations.

## License

MIT

## Legal

- [Terms of Service](TERMS_OF_SERVICE.md)
- [Privacy Policy](PRIVACY_POLICY.md)
