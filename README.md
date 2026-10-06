# Dilemma

International AI-powered Discord quiz bot.

Dilemma lets Discord communities configure quiz topics and daily question limits, then answer AI-generated multiple-choice questions through Discord polls and slash commands.

## Current status

Current MVP:

Latest release: `v0.1.1-alpha`. See [CHANGELOG.md](CHANGELOG.md).

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

## Setup

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
- OPENROUTER_MODEL, default: `openrouter/free`
- DATABASE_URL, default: `file:./dev.db`

Never commit .env or bot/API keys.

## Commands

- `/dilemma create` - create a topic
- `/dilemma configure` - configure interval, question count and generation time
- `/dilemma run` - generate questions immediately
- `/dilemma random option_count:2-4` - generate one random dilemma without a saved topic or topic counter
- `/dilemma list` - list topics
- `/dilemma enable`, `/dilemma disable`, `/dilemma rename`, `/dilemma delete`
- `/dilemma help` or `/help` - show help
- `/settings` - set server language and defaults
- `/poll end` - end a poll and publish its result

## Production notes

- Run the bot continuously. Automatic generation works only while the process is online.
- Use a persistent PostgreSQL database for production. SQLite is intended for local development.
- For PostgreSQL: set `DATABASE_URL`, run `npm run db:generate:postgres`, then `npm run db:migrate:postgres`.
- Recommended free hosting: Oracle Cloud Always Free VM for the bot and Neon Free for PostgreSQL. See [DEPLOYMENT.md](DEPLOYMENT.md).
- Vercel is suitable for a future web dashboard, not for the always-on Discord bot process.
- Global Discord commands can take up to one hour to appear. Guild commands update faster during development.
- Never commit `.env`, Discord tokens or AI API keys.

## Roadmap

### Next release

- Add selectable question difficulty. Proposed levels: easy, medium and hard.
- Apply the selected difficulty to random questions and saved topics, including scheduled generation.
- Pass the difficulty to the AI prompt and display it with each quiz.
- Preserve existing topic settings when introducing the new difficulty field.

### Future releases

1. User scores, streaks and leaderboards
2. More languages and localized help text

## License

MIT

## Legal

- [Terms of Service](TERMS_OF_SERVICE.md)
- [Privacy Policy](PRIVACY_POLICY.md)
