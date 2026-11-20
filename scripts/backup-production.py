import argparse
import fcntl
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4


CLIENT = "postgres:18-alpine"
STORAGE = Path("/var/lib/dilemma/backups")
STAGE = "configuration"


def docker(*args, timeout=60, check=True, **streams):
    result = subprocess.run(["docker", *args], stderr=subprocess.PIPE, timeout=timeout,
                            **({"stdout": subprocess.PIPE} | streams))
    if check and result.returncode:
        raise RuntimeError("PostgreSQL operation failed")
    return result


def credentials(environment):
    values = {}
    for line in environment.read_text().splitlines():
        key, delimiter, value = line.partition("=")
        if delimiter and key in ("DATABASE_URL", "DATABASE_URL_UNPOOLED"):
            if key in values:
                raise RuntimeError("Duplicate database setting")
            values[key] = value
    runtime = urlsplit(values["DATABASE_URL"])
    direct = urlsplit(values.get("DATABASE_URL_UNPOOLED") or values["DATABASE_URL"])

    def direct_host(address):
        host = address.hostname
        if not host or not host.endswith(".neon.tech"):
            raise RuntimeError("Unknown production PostgreSQL endpoint")
        return re.sub(r"-pooler(?=\.)", "", host)

    if any(url.scheme not in ("postgres", "postgresql") or not url.username or not url.password or not url.path[1:]
           for url in (runtime, direct)):
        raise RuntimeError("Invalid PostgreSQL settings")
    host = direct_host(direct)
    if (host, direct.port or 5432, unquote(direct.username), unquote(direct.path[1:])) != (
            direct_host(runtime), runtime.port or 5432, unquote(runtime.username), unquote(runtime.path[1:])):
        raise RuntimeError("Direct connection must match the production database")
    fields = (host, str(direct.port or 5432), unquote(direct.username), unquote(direct.path[1:]), unquote(direct.password))
    if any(not field or any(char in field for char in "\r\n\0") for field in fields):
        raise RuntimeError("Unsupported PostgreSQL connection field")
    return ("\n".join(fields) + "\n").encode()


def private_directory(path):
    if path.resolve() != path:
        raise RuntimeError("Backup directory must be private")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise RuntimeError("Backup directory must be private")


def dump_archive(connection, archive, client=CLIENT):
    reader = 'for key in PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD; do IFS= read -r "$key"; export "$key"; done; '
    command = reader + 'export PGSSLMODE=verify-full PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt PGCONNECT_TIMEOUT=15; exec pg_dump -Fc --no-owner --no-acl'
    docker("run", "--rm", "-i", "--user", "postgres", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
           client, "sh", "-ec", command, input=connection, stdout=archive, timeout=300)


def verify_archive(path, client=CLIENT):
    for args in (("--list",), ("--file=/dev/null", "--no-owner", "--no-acl")):
        with path.open("rb") as archive:
            result = docker("run", "--rm", "-i", "--network", "none", "--cap-drop", "ALL", client,
                            "pg_restore", *args, stdin=archive, timeout=120)
            if args == ("--list",) and b"TABLE DATA" not in result.stdout:
                raise RuntimeError("Archive lacks application tables")


def backup(production, state, release_id):
    global STAGE
    if not production.is_absolute() or production.resolve() != production or not production.is_dir():
        raise RuntimeError("Invalid production directory")
    config = production / ".env.docker"
    if not config.is_file() or config.is_symlink() or config.stat().st_mode & 0o077:
        raise RuntimeError("Production environment file must be private")
    connection = credentials(config)
    private_directory(state)
    folder = state / "before-migration"
    private_directory(folder)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"{stamp}-{release_id}-{uuid4().hex[:8]}.dump"
    with (state / ".backup.lock").open("a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.NamedTemporaryFile(prefix=".pending-", dir=folder, delete=False) as archive:
            temporary = Path(archive.name)
            try:
                STAGE = "dump"
                dump_archive(connection, archive)
                archive.flush()
                os.fsync(archive.fileno())
                STAGE = "archive-verification"
                verify_archive(temporary)
                destination = folder / name
                temporary.rename(destination)
                return destination.stat().st_size
            finally:
                temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("production_directory", type=Path)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9A-Za-z-]{1,64}", args.release_id):
        raise RuntimeError("Invalid release ID")
    os.umask(0o077)
    size = backup(args.production_directory, STORAGE, args.release_id)
    print(json.dumps({"backup_verified": True, "archive_bytes": size}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"backup_verified": False, "stage": STAGE}))
        raise SystemExit(1)
