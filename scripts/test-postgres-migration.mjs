import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== process.env.EXPECTED_TEST_HOST || url.hostname.includes("-pooler")) {
  throw new Error("Migration test requires the explicitly selected direct test endpoint.");
}
const db = new PrismaClient();
const tables = ["Topic", "GuildSettings", "GeneratedPoll", "RandomPoll"];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY "${table === "GuildSettings" ? "guildId" : "id"}"`)])));
try {
  const before = await snapshot();
  await db.$disconnect();
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/postgresql/schema.prisma"], { env: process.env, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Migration failed on test branch. Inspect migration diagnostics privately.");
  const after = await snapshot();
  for (const table of tables) {
    const field = table === "GuildSettings" ? "defaultDifficulty" : "difficulty";
    const alreadyPresent = before[table].some(row => Object.hasOwn(row, field));
    if (!alreadyPresent) assert.ok(after[table].every(row => row[field] === "medium"));
    assert.deepEqual(after[table].map(row => alreadyPresent ? row : Object.fromEntries(Object.entries(row).filter(([key]) => key !== field))), before[table], `Preserve ${table}`);
  }
  const guildId = "migration-difficulty-test";
  const settings = await db.guildSettings.create({ data: { guildId, language: "pl", defaultDifficulty: "hard" } });
  const topic = await db.topic.create({ data: { guildId, name: "Difficulty migration test", options: "", difficulty: settings.defaultDifficulty } });
  assert.equal(topic.difficulty, "hard");
  for (const difficulty of ["easy", "medium", "hard"]) assert.equal((await db.topic.update({ where: { id: topic.id }, data: { difficulty } })).difficulty, difficulty);
  await db.topic.delete({ where: { id: topic.id } });
  await db.guildSettings.delete({ where: { guildId } });
  console.log(JSON.stringify({ ok: true, preservedRows: Object.fromEntries(tables.map(table => [table, before[table].length])), defaults: "medium", allLevelsPersisted: true }));
} catch (error) {
  console.error(`Migration verification failed (${error?.code ?? error?.name ?? "Error"}).`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
