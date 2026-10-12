import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

import { requireTestDatabase } from './test-database-guard.mjs';
requireTestDatabase(process.env);
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
    const addedDefaults = table === "GuildSettings"
      ? { defaultDifficulty: "medium", defaultPollDurationHours: 24, defaultGenerationTime: null }
      : table === "Topic" ? { difficulty: "medium", pollDurationHours: 24 } : { difficulty: "medium" };
    for (const [field, value] of Object.entries(addedDefaults)) {
      if (!before[table].some(row => Object.hasOwn(row, field))) assert.ok(after[table].every(row => row[field] === value));
    }
    const fields = new Set(before[table].flatMap(row => Object.keys(row)));
    assert.deepEqual(after[table].map(row => Object.fromEntries(Object.entries(row).filter(([key]) => fields.has(key)))), before[table], `Preserve ${table}`);
  }
  const guildId = "migration-difficulty-test";
  const settings = await db.guildSettings.create({ data: { guildId, language: "pl", defaultDifficulty: "hard", defaultGenerationTime: "18:30" } });
  assert.equal(settings.defaultGenerationTime, "18:30");
  const topic = await db.topic.create({ data: { guildId, name: "Difficulty migration test", options: "", difficulty: settings.defaultDifficulty } });
  assert.equal(topic.difficulty, "hard");
  for (const difficulty of ["easy", "medium", "hard"]) assert.equal((await db.topic.update({ where: { id: topic.id }, data: { difficulty } })).difficulty, difficulty);
  await db.topic.delete({ where: { id: topic.id } });
  await db.guildSettings.delete({ where: { guildId } });
  console.log(JSON.stringify({ ok: true, preservedRows: Object.fromEntries(tables.map(table => [table, before[table].length])), defaults: "medium", publicationTimePersisted: true, allLevelsPersisted: true }));
} catch (error) {
  console.error(`Migration verification failed (${error?.code ?? error?.name ?? "Error"}).`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
