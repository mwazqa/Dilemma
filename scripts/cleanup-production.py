"""Remove only obsolete stopped bot rollback containers after a healthy deploy."""
import json
import re
import subprocess
import sys
from pathlib import Path


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError("Command failed")
    return result.stdout


try:
    current = json.loads(run(["docker", "inspect", "dilemma"]))[0]
    if not current["State"]["Running"] or current["RestartCount"] != 0 or current["Config"]["User"] != "node" or not current["HostConfig"]["ReadonlyRootfs"]:
        raise RuntimeError("Production not ready")
    if "Logged in as Discord bot" not in run(["docker", "logs", "dilemma"]):
        raise RuntimeError("No login confirmation")
    ids = run(["docker", "ps", "-aq", "--filter", "name=dilemma-rollback-"]).split()
    containers = json.loads(run(["docker", "inspect", *ids])) if ids else []
    targets = sorted([item for item in containers if re.fullmatch(r"/dilemma-rollback-[0-9]{14}-[a-f0-9]{8}", item["Name"])], key=lambda item: item["Created"], reverse=True)
    if any(item["State"]["Running"] or item["Mounts"] for item in targets):
        raise RuntimeError("Unexpected rollback state")
    removed = 0
    for item in targets[1:]:
        # Exact Docker IDs verified above; no force, volumes, images or broad prune.
        run(["docker", "rm", item["Id"]])
        removed += 1
    deployment = Path(sys.argv[1])
    if not re.fullmatch(r"/home/[a-zA-Z0-9_-]+/\.dilemma-deploy", str(deployment)):
        raise RuntimeError("Invalid directory")
    secured = 0
    for path in deployment.iterdir():
        if path.is_dir() and not path.is_symlink() and re.fullmatch(r"[0-9]{14}-[a-f0-9]{8}", path.name):
            path.chmod(0o700)
            for name in ("migration-status.log", "migration-apply.log"):
                log = path / name
                if log.is_file() and not log.is_symlink():
                    log.chmod(0o600)
                    secured += 1
    print(json.dumps({"obsolete_containers_removed": removed, "rollback_containers_retained": min(1, len(targets)), "deployment_logs_secured": secured}))
except Exception:
    print('{"cleanup_failed":true}')
    sys.exit(1)
