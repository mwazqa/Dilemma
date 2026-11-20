import argparse
import fcntl
import json
import re
import subprocess
from pathlib import Path


ROLLBACK = re.compile(r"/dilemma-rollback-[a-zA-Z0-9-]{1,64}")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")
CONTAINER_ID = re.compile(r"[a-f0-9]{64}")
IMAGE_REF = re.compile(r"(?:ghcr\.io/mwazqa/dilemma(?::[a-zA-Z0-9_.-]+|@sha256:[a-f0-9]{64})|dilemma:[a-zA-Z0-9_.-]+)")


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, errors="replace", timeout=45)
    if result.returncode and check:
        raise RuntimeError("Docker check failed")
    return result


def records(command, template, identifiers):
    if not identifiers:
        return []
    output = docker(*command, "--format", template, *identifiers).stdout
    return [json.loads(row) for row in output.splitlines()]


def inventory():
    ids = docker("container", "ls", "-aq", "--no-trunc").stdout.split()
    if not ids or any(not CONTAINER_ID.fullmatch(key) for key in ids):
        raise RuntimeError("Invalid container inventory")
    template = "[{{json .Id}},{{json .Name}},{{json .Image}},{{json .Created}},{{json .State.Status}},{{json .State.StartedAt}},{{json .RestartCount}},{{len .Mounts}},{{json .Config.User}},{{json .HostConfig.ReadonlyRootfs}}]"
    rows = records(("container", "inspect"), template, ids)
    result = {row[0]: tuple(row[1:]) for row in rows}
    if set(result) != set(ids) or any(not IMAGE_ID.fullmatch(row[1]) for row in result.values()):
        raise RuntimeError("Container inventory changed")
    return result


def inspect_images(ids):
    template = "[{{json .Id}},{{json .RepoTags}},{{json .RepoDigests}},{{json .RootFS.Layers}}]"
    return {row[0]: row[1:] for row in records(("image", "inspect"), template, sorted(ids))}


def rollback_candidates(containers):
    candidates = sorted(((key, row) for key, row in containers.items() if ROLLBACK.fullmatch(row[0])),
                        key=lambda entry: entry[1][2], reverse=True)
    if any(row[3] != "exited" or row[6] or row[7] != "node" or not row[8] for _, row in candidates):
        raise RuntimeError("Unexpected rollback container state")
    return candidates


def confirm_bot(containers):
    live = next((key for key, row in containers.items() if row[0] == "/dilemma" and row[3] == "running"), None)
    if not live or containers[live][5] or containers[live][7] != "node" or not containers[live][8]:
        raise RuntimeError("Dilemma is not ready")
    logs = docker("logs", "--tail", "500", live)
    if "Logged in as Discord bot" not in logs.stdout + logs.stderr:
        probe = "import{PrismaClient}from'@prisma/client';const db=new PrismaClient();try{await db.$queryRawUnsafe('SELECT 1')}finally{await db.$disconnect()}"
        docker("exec", live, "node", "--input-type=module", "-e", probe)


def remove_retired_images(candidate_ids, containers):
    attached = {row[1] for row in containers.values()}
    tagged = set(docker("image", "ls", "--no-trunc", "--format", "{{.ID}}").stdout.split())
    images = inspect_images(attached | tagged | candidate_ids)
    removed = 0
    for image in sorted(candidate_ids - attached):
        tags, digests, layers = images[image]
        refs = (tags or []) + (digests or [])
        if not layers or not refs or any(not IMAGE_REF.fullmatch(ref) for ref in refs):
            continue
        if any(key != image and stack and stack[:len(layers)] == layers for key, (_, _, stack) in images.items()):
            continue
        if inventory() != containers:
            raise RuntimeError("Container inventory changed during cleanup")
        result = docker("image", "rm", "--no-prune", image, check=False)
        if result.returncode == 0:
            removed += 1
    return removed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("production_directory", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    directory = args.production_directory
    lock = directory / ".deployment.lock"
    if not directory.is_absolute() or directory.resolve() != directory or not directory.is_dir() or lock.is_symlink():
        raise RuntimeError("Invalid production directory")
    with lock.open("a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = inventory()
        confirm_bot(before)
        rollbacks = rollback_candidates(before)
        kept, retired = rollbacks[:1], rollbacks[1:]
        if kept and kept[0][1][1] not in inspect_images({kept[0][1][1]}):
            raise RuntimeError("The latest rollback image is missing")
        removed_containers = removed_images = 0
        remaining = before.copy()
        if args.apply:
            for key, _ in retired:
                if inventory() != remaining:
                    raise RuntimeError("Container inventory changed before cleanup")
                docker("container", "rm", key)
                remaining.pop(key)
                removed_containers += 1
            if inventory() != remaining:
                raise RuntimeError("Container inventory changed during cleanup")
            removed_images = remove_retired_images({row[1] for _, row in retired}, remaining)
            if inventory() != remaining:
                raise RuntimeError("Container inventory changed after cleanup")
        print(json.dumps({"rollback_retained": len(kept), "retired_candidates": len(retired),
                          "obsolete_containers_removed": removed_containers, "obsolete_images_removed": removed_images,
                          "current_bot_verified": True, "applied": args.apply}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"cleanup_failed":true}')
        raise SystemExit(1)
