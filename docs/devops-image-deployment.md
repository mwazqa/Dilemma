# Tested production image

CI runs the existing checks and the PostgreSQL suite before the ARM64 image job. The image build reads an explicit archive of tracked application files. The job checks the loaded image against a disposable database and then pushes that same image to GitHub Container Registry on successful pushes to `main`. Pull requests build and test without publishing. CI uses synthetic credentials and never connects to production.

The successful `image / arm64` job includes the exact image reference and Git commit. Copy both from that job. The deployment command verifies the reference against the dedicated artifact from successful CI for that commit on `main`. Registry read access must already be available to Docker on the server if the package is private.

```powershell
npm run deploy:prod -- -Image 'ghcr.io/mwazqa/dilemma@sha256:<digest>' -Commit '<full commit SHA>'
```

The server checks free disk space, pulls the tested ARM64 image by digest and checks its commit label. Pending migrations stop deployment by default. For a migration release, verify a production backup through the existing release process, then use `-ApplyMigrations`. When the new container starts, the switch checks Discord login, restart count and database read access. A failed switch restores the previous container. Additive database migrations stay applied during application rollback. Image deployment retains previous containers and does not delete images.

The source-based deployment remains available for coordinated recovery. The normal release process still reviews the player guide, registers changed Discord commands and publishes the GitHub release after production verification. Publishing a container package is not a GitHub Release and does not send a player announcement.

## Disk warning

The `dilemma-disk-monitor.timer` unit runs every five minutes. Below 20% available space, the check writes a warning to the system journal and reports a failed unit. Image deployment also checks the same threshold before pulling. This monitor reports locally on the host. Forwarding to a notification channel needs a separate destination.

Install the monitor with `sudo bash scripts/install-disk-monitor.sh`. Run this from a directory containing the monitor script and its two files under `scripts/systemd`. The installer refuses to overwrite a different unit and verifies the installed files before enabling the timer.

```bash
systemctl status dilemma-disk-monitor.timer
journalctl -u dilemma-disk-monitor.service -p warning
```
