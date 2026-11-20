#!/usr/bin/env bash
set -Eeuo pipefail

context="${1:?A new build-context directory is required}"
mkdir -- "$context"
git archive --format=tar HEAD -- Dockerfile .dockerignore package.json package-lock.json tsconfig.json .env.example src prisma/postgresql scripts |
  tar -xf - -C "$context"

if find "$context" -type l -print -quit | grep -q .; then
  echo 'The build context contains a symbolic link.' >&2
  exit 1
fi
if find "$context" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.ppk' -o -name '*.key' -o -name '*.db' -o -name '.deploy.production.json' -o -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_ecdsa' \) ! -name '.env.example' -print -quit | grep -q .; then
  echo 'The build context contains a file reserved for local configuration.' >&2
  exit 1
fi
