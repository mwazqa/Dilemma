import "dotenv/config";
import { spawnSync } from "node:child_process";

try {
  const runtime = new URL(process.env.DATABASE_URL || "");
  const direct = new URL(process.env.DATABASE_URL_UNPOOLED || runtime.toString());
  const directHost = hostname => hostname.endsWith(".neon.tech") ? hostname.replace(/-pooler(?=\.)/, "") : hostname;
  if (directHost(runtime.hostname) !== directHost(direct.hostname) || runtime.pathname !== direct.pathname || runtime.username !== direct.username) {
    throw new Error("Direct connection must belong to the runtime database");
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol)) throw new Error("PostgreSQL URL required");
  direct.hostname = directHost(direct.hostname);
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/postgresql/schema.prisma"], {
    env: { ...process.env, DATABASE_URL: direct.toString() }, encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("Migration failed");
  console.log("PostgreSQL migrations applied successfully using the direct connection.");
} catch {
  console.error("PostgreSQL migration failed. Check database access and migration status privately before starting the bot.");
  process.exitCode = 1;
}
