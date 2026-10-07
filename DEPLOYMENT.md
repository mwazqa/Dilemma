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
docker run --rm \
  --volume "$PWD:/deployment" \
  --entrypoint node \
  dilemma scripts/prepare-docker-env.mjs /deployment/.env /deployment/.env.docker
sudo chown "$(id -u):$(id -g)" .env.docker
docker run --rm --env-file .env.docker dilemma npm run db:migrate:postgres
docker run -d \
  --name dilemma \
  --restart unless-stopped \
  --user node --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env TZ=Europe/Warsaw \
  --env-file .env.docker \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  dilemma
```

Apply PostgreSQL migrations explicitly before starting the read-only bot container.
Back up production data before a schema change. The running bot never applies migrations.
The preparation command converts dotenv quoting to Docker's environment-file
format and writes a separate file with owner-only permissions. Rerun it whenever
you change `.env`. The `Europe/Warsaw` timezone keeps configured quiz hours in
Polish local time; change it if your server uses another timezone.

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
docker run --rm --env-file .env.docker dilemma node dist/register-commands.js
```

Global commands can take time to appear in Discord.

## Updates

### Direct local deployment without GitHub

On Windows, create an ignored `.deploy.production.json` with `host`, `user`, `path` and `key` (the local SSH private-key file path). Never put the key contents in this file or the repository. The SSH host must already be trusted in `known_hosts`.

Run `npm run deploy:prod`. The script checks and builds the code, runs scoring and feature tests, then sends an explicit code-only archive over SSH. It builds the image while the existing bot stays online and checks that database migrations have already been applied. Pending migrations stop deployment before the production container is changed; back up the database and apply migrations separately.

The old container is stopped and retained under `dilemma-rollback-<deployment-id>`. If the replacement does not confirm Discord login within 45 seconds, the old container is restored automatically. Discord login does not verify every command; manually check `/score profile` and `/score leaderboard` after deployment.

The server checkout is not updated. Running `git pull` and rebuilding that checkout later can replace the directly deployed changes. Infrastructure details and raw remote output are deliberately withheld. After confirmed login, cleanup keeps the newest stopped rollback container and removes older stopped bot rollback containers, including their local logs and configuration. Docker images and volumes are not pruned.

To roll back manually, identify the exact retained container locally on the server. Do not paste its configuration or logs into chat:

```bash
sudo docker stop dilemma
sudo docker rename dilemma dilemma-rejected-<deployment-id>
sudo docker rename dilemma-rollback-<deployment-id> dilemma
sudo docker start dilemma
```

### Updates from GitHub

```bash
git pull
docker build -t dilemma .
docker run --rm --volume "$PWD:/deployment" --entrypoint node dilemma scripts/prepare-docker-env.mjs /deployment/.env /deployment/.env.docker
sudo chown "$(id -u):$(id -g)" .env.docker
docker run --rm --env-file .env.docker dilemma npm run db:migrate:postgres
docker rm -f dilemma
docker run -d --name dilemma --restart unless-stopped --user node --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --env TZ=Europe/Warsaw --env-file .env.docker --log-opt max-size=10m --log-opt max-file=3 dilemma
```

## Logs

Run `npm run security:production` from the local Windows checkout for sanitized
log-scan counts and host access checks. Logs remain on the server. Never paste raw
Docker logs, environment inspections or exceptions into chat or public issues.
The audit checks bot containers and migration-status logs against their configured
credentials and recognizable credential patterns. It does not prove all secrets
are absent and does not audit Oracle IAM, provider snapshots or remote backup storage.

Only trusted host administrators and users with Docker control should have log
access. Docker access also permits reading container environment secrets.
The active bot runs as `node`, drops Linux capabilities, forbids new privileges,
and uses a read-only root filesystem with a bounded temporary directory.

## Backups

Neon Free is suitable for the MVP, but do not treat it as the only backup.
Export PostgreSQL data before major migrations or use a second backup location.
