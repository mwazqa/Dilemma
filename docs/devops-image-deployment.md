# Tested production image

CI runs the existing checks and the PostgreSQL suite before the ARM64 image job. The image build reads an explicit archive of tracked application files. The job checks the loaded image against a disposable database and then pushes that same image to GitHub Container Registry on successful pushes to `main`. Pull requests build and test without publishing. CI uses synthetic credentials and never connects to production.

The successful `image / arm64` job includes the exact image reference and Git commit. Pass the commit to the deployment command. It obtains the reference from the dedicated artifact of successful CI on `main`. An optional `-Image` must match that artifact. Registry read access must already be available to Docker on the server if the package is private.

```powershell
npm run deploy:prod -- -Commit '<full commit SHA>'
```

The server checks free disk space, pulls the tested ARM64 image by digest and checks its commit label. Pending migrations stop deployment by default. For a migration release, pass `-ApplyMigrations`. The deploy script first writes a private PostgreSQL backup and verifies that `pg_restore` can read its contents. Any backup failure stops before migration. The database connection stays on the host and credentials reach the dump process through standard input. Migration credentials and archives do not enter GitHub Actions or Docker build contexts.

When the new container starts, the deploy script checks Discord login, restart count and database read access. A failed switch restores the previous container. Additive database migrations stay applied during application rollback. After a successful switch, a separate cleanup command retains one previous container. It removes an older image only when no container refers to it and no retained image uses its layer stack. A cleanup failure reports a warning and leaves the verified new container running.

The source-based deployment remains available for coordinated recovery. The normal release process still reviews the player guide, registers changed Discord commands and publishes the GitHub release after production verification. Publishing a container package is not a GitHub Release and does not send a player announcement.

## Disk warning

The `dilemma-disk-monitor.timer` unit runs every five minutes. Below 20% available space, the check writes a warning to the system journal and reports a failed unit. Image deployment also checks the same threshold before pulling. This monitor reports locally on the host. Forwarding to a notification channel needs a separate destination.

Install the monitor with `sudo bash scripts/install-disk-monitor.sh`. Run this from a directory containing the monitor script and its two files under `scripts/systemd`. The installer refuses to overwrite a different unit and verifies the installed files before enabling the timer.

```bash
systemctl status dilemma-disk-monitor.timer
journalctl -u dilemma-disk-monitor.service -p warning
```

## Pre-migration backup archives

The release process keeps verified pre-migration archives in the private host backup directory. They are distinct from the image and from rollback containers. Previously saved daily archives remain available in their original directory.

Treat backup archives as production data. Keep them out of Git, GitHub Actions, Discord and application deployment archives.
