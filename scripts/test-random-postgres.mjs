import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

const prefix = `random-test-${randomUUID()}`;
const guilds = ["parallel", "other", "release", "legacy", "published"].map(name => `${prefix}-${name}`);
let db;
let originalTransaction;

async function main() {
  requireTestDatabase(process.env);
  Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
  ({ db } = await import("../dist/db.js"));
  originalTransaction = db.$transaction.bind(db);
  const { claimQuizRun, refreshRandomQuizRun, releaseQuizRun, quizDayBounds, DailyQuizLimitError,
    RandomQuizCooldownError, RANDOM_COOLDOWN_MS } = await import("../dist/services/quiz-limits.js");
  const firstAt = new Date(+quizDayBounds(new Date()).start + 3_600_000);
  const simultaneous = async (guildId, at) => {
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun(guildId, undefined, at)));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(attempts.filter(result => result.status === "rejected").every(result =>
      result.reason instanceof RandomQuizCooldownError || result.reason instanceof DailyQuizLimitError));
    return attempts.find(result => result.status === "fulfilled").value;
  };
  await simultaneous(guilds[0], firstAt);
  await simultaneous(guilds[0], new Date(+firstAt + RANDOM_COOLDOWN_MS));
  await assert.rejects(claimQuizRun(guilds[0], undefined, new Date(+firstAt + 2 * RANDOM_COOLDOWN_MS)), DailyQuizLimitError);
  assert.equal(await db.dailyQuizRun.count({ where: { guildId: guilds[0], scope: "random-daily" } }), 2);
  const tomorrow = quizDayBounds(firstAt).end;
  await claimQuizRun(guilds[0], undefined, new Date(+tomorrow + 3_600_000));
  await claimQuizRun(guilds[1], undefined, firstAt);
  await claimQuizRun(guilds[0], `${prefix}-topic`, firstAt);

  const lease = await claimQuizRun(guilds[2]);
  await new Promise(resolve => setTimeout(resolve, 5));
  db.$transaction = (callback, options) => originalTransaction(tx => callback(new Proxy(tx, {
    get(target, property) {
      if (property !== "dailyQuizRun") return target[property];
      return new Proxy(target.dailyQuizRun, {
        get(delegate, method) {
          if (method !== "updateMany") return delegate[method];
          return async request => {
            if (request.where.scope === "random-daily") throw new Error("Injected daily refresh failure");
            return delegate.updateMany(request);
          };
        }
      });
    }
  })), options);
  await assert.rejects(refreshRandomQuizRun(lease), /Injected/);
  db.$transaction = originalTransaction;
  const afterFailure = await db.dailyQuizRun.findUnique({ where: { guildId_scope_day_slot: {
    guildId: lease.guildId, scope: lease.scope, day: lease.day, slot: lease.slot } } });
  assert.equal(+afterFailure.createdAt, +lease.createdAt);
  await releaseQuizRun(lease);
  assert.equal(await db.dailyQuizRun.count({ where: { guildId: guilds[2] } }), 0);

  await db.dailyQuizRun.create({ data: { guildId: guilds[3], scope: "random", day: "cooldown", slot: 1, createdAt: firstAt } });
  await claimQuizRun(guilds[3], undefined, new Date(+firstAt + RANDOM_COOLDOWN_MS));
  await assert.rejects(claimQuizRun(guilds[3], undefined, new Date(+firstAt + 2 * RANDOM_COOLDOWN_MS)), DailyQuizLimitError);
  for (let index = 0; index < 2; index++) {
    await db.randomPoll.create({ data: { guildId: guilds[4], language: "en", messageId: `${prefix}-poll-${index}`,
      channelId: "test-only", question: "Test?", options: "A||B", correctOption: 0, explanation: "Test.", createdAt: firstAt } });
  }
  await assert.rejects(claimQuizRun(guilds[4], undefined, new Date(+firstAt + RANDOM_COOLDOWN_MS)), DailyQuizLimitError);
  assert.equal(await db.dailyQuizRun.count({ where: { guildId: guilds[4] } }), 0);
  console.log(JSON.stringify({ ok: true, concurrentClaims: true, dailyCap: true, guildAndTopicIsolation: true,
    rollback: true, failureRelease: true, upgradeHistory: true }));
}

try { await main(); }
catch { console.error("Isolated random quota test failed. Raw output withheld."); process.exitCode = 1; }
finally {
  if (db) {
    db.$transaction = originalTransaction;
    try {
      await db.dailyQuizRun.deleteMany({ where: { guildId: { in: guilds } } });
      await db.randomPoll.deleteMany({ where: { guildId: { in: guilds } } });
    } catch { console.error("Isolated random quota cleanup failed. Raw output withheld."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
