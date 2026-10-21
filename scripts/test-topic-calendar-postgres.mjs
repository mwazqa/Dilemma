import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

let db;
let topic;
const guildId = `calendar-test-${randomUUID()}`;
try {
  requireTestDatabase(process.env);
  Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
  ({ db } = await import("../dist/db.js"));
  const { quizDay, claimQuizRun, releaseQuizRun, TopicScheduleNotReadyError, DailyQuizLimitError } = await import("../dist/services/quiz-limits.js");
  const now = new Date();
  topic = await db.topic.create({ data: { guildId, name: "Isolated calendar test", options: "A,B", optionCount: 2,
    startDate: quizDay(now), generationTime: "18:00", intervalDays: 7 } });
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun(guildId, topic.id, now)));
  assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(attempts.filter(item => item.status === "rejected").every(item => item.reason instanceof TopicScheduleNotReadyError || item.reason instanceof DailyQuizLimitError));
  const lease = attempts.find(item => item.status === "fulfilled").value;
  assert.equal(await db.dailyQuizRun.count({ where: { guildId } }), 2);
  await assert.rejects(claimQuizRun(guildId, topic.id, new Date(+now + 86_400_000)), TopicScheduleNotReadyError);
  assert.equal(await db.dailyQuizRun.count({ where: { guildId } }), 2, "Cycle conflict rolls back the new day's daily reservation");
  await releaseQuizRun(lease);
  assert.equal(await db.dailyQuizRun.count({ where: { guildId } }), 0);
  const recovered = await claimQuizRun(guildId, topic.id, new Date(+now + 86_400_000));
  assert.equal(recovered.cycleRun.day, topic.startDate);
  await releaseQuizRun(recovered);
  console.log(JSON.stringify({ ok: true, concurrentCycleClaims: true, crossDayRollback: true, releasedPairs: true, startDatePersisted: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "isolated-calendar-postgres", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-topic-calendar-postgres\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  if (db) {
    try {
      await db.dailyQuizRun.deleteMany({ where: { guildId } });
      if (topic) await db.topic.delete({ where: { id: topic.id } });
    } catch { console.error("Isolated calendar cleanup failed. Raw output withheld."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
