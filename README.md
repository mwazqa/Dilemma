# Dylematic

International AI-powered Discord quiz bot.

Dylematic lets Discord communities configure topics and daily question limits, then answer AI-generated multiple-choice questions through Discord polls or slash commands.

## Current status

Initial project skeleton:

- TypeScript + Node.js
- discord.js client with /ping
- slash-command registration for a guild or globally
- OpenAI question-generator service with Zod validation
- environment-based secret configuration

## Setup

Requirements: Node.js 22+ and a Discord application/bot.

1. Run npm install.
2. Copy .env.example to .env.
3. Fill in the Discord credentials.
4. Run npm run register.
5. Run npm run dev.

Required variables:

- DISCORD_TOKEN
- DISCORD_CLIENT_ID
- DISCORD_GUILD_ID during development
- OPENAI_API_KEY for AI generation

Never commit .env or bot/API keys.

## Roadmap

1. Server and topic configuration
2. AI-generated daily questions
3. Poll and slash-command answering modes
4. User scores, streaks and leaderboards
5. Internationalization
6. PostgreSQL + Prisma persistence

## License

MIT
