import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { requireTestDatabase } from './test-database-guard.mjs';
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { db } = await import("../dist/db.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const tables = ["Topic", "GuildSettings", "GeneratedPoll", "RandomPoll"];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table,
  await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY "${table === "GuildSettings" ? "guildId" : "id"}"`)])));
const guildId = `scoring-test-${randomUUID()}`;
const secondGuild = `${guildId}-other`;
const originalTransaction = db.$transaction.bind(db);
try {
  const before = await snapshot();
  await db.$disconnect();
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/postgresql/schema.prisma"], { env: process.env, encoding: "utf8" });
  assert.equal(migration.status, 0, "Isolated migration must succeed");
  assert.deepEqual(await snapshot(), before, "Scoring migration preserves all existing data");
  assert.equal(await db.quizSettlement.count(), 0, "No retroactive scoring");
  const createQuiz = (name, difficulty, guild = guildId) => db.quizSettlement.create({ data: {
    messageId: `${guildId}-${name}`, guildId: guild, channelId: "test-only", difficulty, answerIds: "17,93", correctAnswerId: 17, expiresAt: new Date(0) } });
  const late = await createQuiz("late", "hard");
  const results = await Promise.all(Array.from({ length: 3 }, () => applyFinalVotes(late, [{ userId: "player", answerId: 17 }], new Date(2000))));
  assert.equal(results.filter(Boolean).length, 1, "Concurrent workers score once");
  const early = await createQuiz("early", "easy");
  await applyFinalVotes(early, [{ userId: "player", answerId: 93 }], new Date(1000));
  let player = await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: "player" } } });
  assert.equal(player.currentStreak, 1, "Streak uses finish order, not retry order");
  assert.equal(player.points, 3); assert.equal(player.answered, 2);
  const latest = await createQuiz("latest", "medium");
  await applyFinalVotes(latest, [{ userId: "player", answerId: 17 }], new Date(3000));
  player = await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: "player" } } });
  assert.equal(player.currentStreak, 2); assert.equal(player.bestStreak, 2); assert.equal(player.points, 5);
  const other = await createQuiz("other", "easy", secondGuild);
  await applyFinalVotes(other, [{ userId: "player", answerId: 17 }], new Date(1000));
  assert.equal((await db.userScore.findUnique({ where: { guildId_userId: { guildId: secondGuild, userId: "player" } } })).points, 1);
  const empty = await createQuiz("empty", "easy");
  await applyFinalVotes(empty, [], new Date(4000));
  assert.equal((await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: "player" } } })).currentStreak, 2);
  const rollback = await createQuiz("rollback", "hard");
  db.$transaction = (cb, options) => originalTransaction(tx => cb(new Proxy(tx, { get(target, key) {
    return key === "userScore" ? { upsert: async () => { throw new Error("Injected score write failure"); } } : target[key];
  } })), options);
  await assert.rejects(applyFinalVotes(rollback, [{ userId: "player", answerId: 17 }], new Date(5000)), /Injected/);
  db.$transaction = originalTransaction;
  assert.equal((await db.quizSettlement.findUnique({ where: { messageId: rollback.messageId } })).scoredAt, null);
  assert.equal(await db.quizAnswer.count({ where: { messageId: rollback.messageId } }), 0, "Rollback leaves no partial votes");
  await db.$transaction([db.quizAnswer.deleteMany({ where: { guildId, userId: "player" } }), db.userScore.deleteMany({ where: { guildId, userId: "player" } })]);
  assert.equal(await applyFinalVotes(late, [{ userId: "player", answerId: 17 }], new Date(2000)), false, "Privacy deletion does not rescore history");
  assert.equal(await db.userScore.count({ where: { guildId } }), 0);
  console.log(JSON.stringify({ ok: true, preservedRows: Object.fromEntries(tables.map(table => [table, before[table].length])), concurrentSettlement: true, chronologicalStreaks: true, rollback: true, guildIsolation: true, privacyDeletion: true }));
} catch (error) { console.error(`Scoring database test failed (${error?.code ?? error?.name ?? "Error"}).`); process.exitCode = 1; }
finally {
  db.$transaction = originalTransaction;
  await db.quizSettlement.deleteMany({ where: { guildId: { in: [guildId, secondGuild] } } }).catch(() => {});
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, secondGuild] } } }).catch(() => {});
  await db.$disconnect();
}
