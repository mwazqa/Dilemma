"""Read-only production audit. Emit counts and allowlisted fields, never raw data."""
import collections
import glob
import grp
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError("Audit command failed")
    return result.stdout


def main():
    production = Path(sys.argv[1])
    deployment = Path(sys.argv[2])
    if not re.fullmatch(r"/[a-zA-Z0-9/_-]+", str(production)) or not re.fullmatch(r"/home/[a-zA-Z0-9_-]+/\.dilemma-deploy", str(deployment)):
        raise RuntimeError("Invalid target")
    ids = run(["docker", "ps", "-aq"]).split()
    containers = json.loads(run(["docker", "inspect", *ids])) if ids else []
    targets = [item for item in containers if item["Name"] == "/dilemma" or re.fullmatch(r"/dilemma-rollback-[a-zA-Z0-9-]+", item["Name"])]
    secrets = set()
    for item in targets:
        for entry in item["Config"].get("Env", []):
            key, _, value = entry.partition("=")
            if re.search(r"TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL", key, re.I) and len(value) >= 8:
                secrets.add(value)
                try:
                    password = unquote(urlsplit(value).password or "")
                    if len(password) >= 8:
                        secrets.add(password)
                except ValueError:
                    pass
    categories = collections.Counter()
    source_counts = collections.Counter()
    lines_checked = 0
    pattern = re.compile(r"(?:discord(?:app)?\.com/api/(?:v\d+/)?(?:webhooks|interactions)/\d+/[\w.-]{20,}|postgres(?:ql)?://[^\s]+|sk-[A-Za-z0-9_-]{20,})", re.I)

    def check_line(line, source):
        nonlocal lines_checked
        lines_checked += 1
        if any(secret in line for secret in secrets):
            categories["configured_credential"] += 1
            source_counts[source] += 1
        elif pattern.search(line):
            categories["credential_like_text"] += 1
            source_counts[source] += 1

    for item in targets:
        process = subprocess.Popen(["docker", "logs", item["Id"]], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        for line in process.stdout:
            check_line(line, "container")
        if process.wait() != 0:
            raise RuntimeError("Log read failed")
    files_checked = 0
    if deployment.is_dir():
        for path in deployment.glob("*/migration-status.log"):
            if path.is_symlink() or not path.is_file():
                continue
            files_checked += 1
            with path.open(errors="replace") as log:
                for line in log:
                    check_line(line, "deployment")
    accounts = pwd.getpwall()
    uid_zero = sum(account.pw_uid == 0 for account in accounts)
    sudo_members = set()
    for group in grp.getgrall():
        if group.gr_name in ("sudo", "wheel", "docker"):
            sudo_members.update(group.gr_mem)
            sudo_members.update(account.pw_name for account in accounts if account.pw_gid == group.gr_gid)
    admin_keys = 0
    for account in accounts:
        if account.pw_uid != 0 and account.pw_name not in sudo_members:
            continue
        path = Path(account.pw_dir) / ".ssh/authorized_keys"
        if path.is_file():
            admin_keys += sum(bool(line.strip()) and not line.lstrip().startswith("#") for line in path.read_text(errors="replace").splitlines())
    sudo_files = [Path("/etc/sudoers"), *Path("/etc/sudoers.d").glob("*")]
    additional_sudo_rules = 0
    for path in sudo_files:
        if path.is_file():
            for line in path.read_text(errors="replace").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith(("#", "@", "Defaults")) and "ALL" in stripped:
                    additional_sudo_rules += 1
    forwarding = 0
    for path in [Path("/etc/rsyslog.conf"), *Path("/etc/rsyslog.d").glob("*.conf")]:
        if path.is_file():
            text = "\n".join(line for line in path.read_text(errors="replace").splitlines() if not line.lstrip().startswith("#"))
            forwarding += len(re.findall(r"omfwd|omhttp|omkafka|@@?\S+", text))
    services = run(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"])
    collector_count = sum(bool(re.search(r"filebeat|fluent|vector|promtail|alloy|logstash|cloudwatch|datadog", line, re.I)) for line in services.splitlines())
    oracle_agent = any("oracle-cloud-agent" in line for line in services.splitlines())
    scheduled_files = [Path("/etc/crontab"), *Path("/etc/cron.d").glob("*"), *Path("/var/spool/cron/crontabs").glob("*")]
    backup_jobs = 0
    for path in scheduled_files:
        if path.is_file():
            backup_jobs += sum(bool(re.search(r"\b(restic|borg|rclone|duplicity|rsync|pg_dump|backup)\b", line, re.I)) for line in path.read_text(errors="replace").splitlines() if not line.lstrip().startswith("#"))
    timers = run(["systemctl", "list-timers", "--all", "--no-legend", "--no-pager"])
    backup_timers = sum(bool(re.search(r"restic|borg|backup|rclone", line, re.I)) for line in timers.splitlines())
    system_package_backup_timers = sum("dpkg-db-backup" in line for line in timers.splitlines())
    print(json.dumps({
        "containers_checked": len(targets), "log_lines_checked": lines_checked,
        "deployment_logs_checked": files_checked, "configured_credential_matches": categories["configured_credential"],
        "credential_like_matches": categories["credential_like_text"], "container_match_lines": source_counts["container"],
        "deployment_match_lines": source_counts["deployment"], "uid_zero_accounts": uid_zero,
        "privileged_group_members": len(sudo_members), "admin_authorized_key_entries": admin_keys,
        "sudo_policy_rule_count": additional_sudo_rules, "log_forwarding_rules": forwarding,
        "known_log_collector_services": collector_count, "cloud_agent_running": oracle_agent,
        "scheduled_backup_entries": backup_jobs, "backup_timers": backup_timers,
        "system_package_backup_timers": system_package_backup_timers,
        "env_file_mode": oct(stat.S_IMODE((production / ".env.docker").stat().st_mode))[2:],
        "scope": "host checks only; cloud IAM, snapshots and external backup storage not verified"
    }))


try:
    main()
except Exception:
    print('{"audit_failed":true}')
    sys.exit(1)
