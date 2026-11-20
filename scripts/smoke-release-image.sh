#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:?An image reference is required}"
[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/arm64 ]]
[[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == node ]]
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "${GITHUB_SHA:?}" ]]

isolated=(--rm --user node --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,noexec,nosuid,size=64m)
database=(--network host --env DATABASE_URL=postgresql://test:test@127.0.0.1:5432/dilemma_image_test)
docker run "${isolated[@]}" --network none "$image" node --input-type=module -e '
  import sharp from "sharp";
  import { existsSync } from "node:fs";
  if (process.arch !== "arm64" || process.getuid() === 0 || !existsSync("dist/index.js")) process.exit(1);
  const file = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#443388" } }).png().toBuffer();
  if (file.subarray(1, 4).toString() !== "PNG") process.exit(1);
'
docker run "${isolated[@]}" "${database[@]}" "$image" node scripts/migrate-postgres.mjs
docker run "${isolated[@]}" "${database[@]}" "$image" node node_modules/prisma/build/index.js migrate status --schema prisma/postgresql/schema.prisma
docker run "${isolated[@]}" "${database[@]}" "$image" node --input-type=module -e '
  import { PrismaClient } from "@prisma/client";
  const db = new PrismaClient();
  try { await db.userScore.count(); } finally { await db.$disconnect(); }
'
