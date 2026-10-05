# Dilemma deployment

Recommended free setup:

- Oracle Cloud Always Free VM for the always-on Discord process
- Neon Free for PostgreSQL
- Vercel only for a future web dashboard, not for the Discord gateway process

## Why this setup

Dilemma keeps a Discord Gateway connection open and runs a local scheduler.
The bot process must stay alive. Serverless functions are not a suitable place
for this process.

## Neon PostgreSQL

1. Create a project at https://neon.tech.
2. Copy the pooled PostgreSQL connection string.
3. Keep the SSL parameters provided by Neon.
4. Use the connection string as `DATABASE_URL`.

Example format:

```text
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

## Oracle Cloud VM

1. Create an Oracle Cloud account at https://cloud.oracle.com.
2. Create an Always Free VM in your home region.
3. Use Ubuntu 24.04 or another supported Linux image.
4. Open SSH access only during setup. Keep the application ports closed because
   Dilemma does not need inbound HTTP traffic.
5. Install Docker on the VM.
6. Clone this repository.
7. Create a production `.env` file with the required values.
8. Start the container:

```bash
docker build -t dilemma .
docker run -d \
  --name dilemma \
  --restart unless-stopped \
  --env-file .env \
  dilemma
```

The container runs PostgreSQL migrations before starting the bot.

## Required production variables

```text
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_REGISTER_GLOBAL=true
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
AI_MAX_RETRIES=3
AI_MIN_INTERVAL_MS=1000
DATABASE_URL=postgresql://...
```

`DISCORD_GUILD_ID` is optional when global command registration is enabled.

## Register commands

Run registration once from the VM, using the same `.env`:

```bash
docker run --rm --env-file .env dilemma npm run register
```

Global commands can take time to appear in Discord.

## Updates

```bash
git pull
docker build -t dilemma .
docker rm -f dilemma
docker run -d --name dilemma --restart unless-stopped --env-file .env dilemma
```

## Logs

```bash
docker logs -f dilemma
```

## Backups

Neon Free is suitable for the MVP, but do not treat it as the only backup.
Export PostgreSQL data before major migrations or use a second backup location.
