import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireTestDatabase } from "./test-database-guard.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { applyFinalVotes, scoreHistory } = await import("../dist/services/scoring.js");
const { experienceProgress } = await import("../dist/services/experience.js");
const { maxWalletValue } = await import("../dist/services/sparks.js");
const { exchangeSparks } = await import("../dist/services/spark-exchange.js");
const { achievementProgress } = await import("../dist/services/achievements.js");
const { quizPersonalPayload } = await import("../dist/services/quiz-personal.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const guildId = "streak-" + randomUUID(), otherGuild = guildId + "-other";
const originalTransaction = db.$transaction.bind(db), originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request in streak tests"); };
const key = (userId, guild = guildId) => ({ guildId_userId: { guildId: guild, userId } });
const wallet = (userId, guild = guildId) => db.userScore.findUnique({ where: key(userId, guild) });
const storedAnswer = (quiz, userId) => db.quizAnswer.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId } } });
let stage = "migration";
async function makeQuiz(name, guild = guildId, votingMode = "native") {
  return db.quizSettlement.create({ data: { messageId: `${guild}-${name}`, guildId: guild, channelId: "test-channel",
    difficulty: "easy", answerIds: "1,2", correctAnswerId: 1, expiresAt: new Date(0), votingMode } });
}
async function settle(quiz, userId, at, correct = true) {
  const votes = [{ userId, answerId: correct ? 1 : 2 }];
  if (quiz.votingMode === "buttons") await db.quizVote.create({ data: { ...votes[0], guildId: quiz.guildId, messageId: quiz.messageId } });
  assert.equal(await applyFinalVotes(quiz, votes, new Date(at)), true);
  return storedAnswer(quiz, userId);
}
async function seedHistory(userId, points, bonusExp = 0, sparks = 20) {
  for (let index = 0; index < points.length; index++) {
    const quiz = await makeQuiz(`${userId}-legacy-${index}`);
    await db.quizSettlement.update({ where: { messageId: quiz.messageId }, data: { scoredAt: new Date() } });
    await db.quizAnswer.create({ data: { guildId, messageId: quiz.messageId, userId, answerId: points[index] ? 1 : 2,
      correct: points[index] > 0, points: points[index], finishedAt: new Date((index + 1) * 1000) } });
  }
  const score = scoreHistory(points.map(value => ({ correct: value > 0, points: value })));
  await db.userScore.create({ data: { guildId, userId, ...score, bonusExp, sparks } });
}
try {
  const migration = readFileSync("prisma/postgresql/migrations/20261118140000_streak_experience/migration.sql", "utf8");
  const schema = "streak_" + randomUUID().replaceAll("-", "");
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRawUnsafe('CREATE TABLE "QuizAnswer" ("points" INTEGER NOT NULL, "correct" BOOLEAN NOT NULL)');
    await tx.$executeRawUnsafe('INSERT INTO "QuizAnswer" VALUES (3, true), (0, false)');
    await tx.$executeRawUnsafe(migration);
    assert.deepEqual(await tx.$queryRawUnsafe('SELECT "points", "correct", "streakExp" FROM "QuizAnswer" ORDER BY "points"'),
      [{ points: 0, correct: false, streakExp: 0 }, { points: 3, correct: true, streakExp: 0 }]);
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  });
  stage = "increasing-bonus";
  let bonus = 0, last;
  for (let index = 0; index < 12; index++) {
    last = await makeQuiz(`serial-${index}`);
    const receipt = await settle(last, "serial", (index + 1) * 1000);
    const expected = Math.min(Math.max(0, index - 1) * 5, 40); bonus += expected;
    assert.equal(receipt.streakExp, expected);
    const player = await wallet("serial");
    assert.equal(player.points, index + 1); assert.equal(player.bonusExp, bonus);
    assert.equal(experienceProgress(player.points, player.bonusExp).totalExp, (index + 1) * 10 + bonus);
    assert.equal(player.sparks, index + 1 + (index >= 5 ? 5 : 0) + (index >= 10 ? 5 : 0));
    const snapshot = await wallet("serial");
    assert.equal(await applyFinalVotes(last, [{ userId: "serial", answerId: 1 }], new Date((index + 1) * 1000)), false);
    assert.deepEqual(await wallet("serial"), snapshot);
  }
  assert.equal(bonus, 260);
  stage = "private-result";
  await db.randomPoll.create({ data: { guildId, channelId: last.channelId, messageId: last.messageId, language: "en",
    question: "Synthetic streak question?", options: '["Correct","Wrong"]', correctOption: 0, explanation: "Test fact." } });
  for (const language of messageLanguages) {
    const result = await quizPersonalPayload(last, "serial", language);
    assert.ok(result.content.includes(message(language, "quizStreakBonus", { exp: 40 })));
    assert.ok(result.content.includes(feedbackKaomoji.quizStreakBonus));
    assert.doesNotMatch(result.content, /\{\w+\}/);
  }
  stage = "wrong-and-skipped";
  const missed = await makeQuiz("missed");
  assert.equal((await settle(missed, "serial", 13000, false)).streakExp, 0);
  assert.equal((await wallet("serial")).bonusExp, 260); assert.equal((await wallet("serial")).currentStreak, 0);
  const restart = await makeQuiz("restart"); assert.equal((await settle(restart, "serial", 14000)).streakExp, 0);
  const skipped = await makeQuiz("skipped"); await applyFinalVotes(skipped, [], new Date(15000));
  const continued = await makeQuiz("continued", guildId, "buttons");
  assert.equal((await settle(continued, "serial", 16000)).streakExp, 0);
  assert.equal((await wallet("serial")).currentStreak, 2);
  const third = await makeQuiz("third-after-reset", guildId, "buttons");
  assert.equal((await settle(third, "serial", 17000)).streakExp, 5);
  assert.equal((await wallet("serial")).bonusExp, 265);
  const other = await makeQuiz("isolated", otherGuild);
  assert.equal((await settle(other, "serial", 18000)).streakExp, 0);
  assert.equal((await wallet("serial", otherGuild)).bonusExp, 0);
  stage = "bonus-level-and-exchange";
  await seedHistory("boundary", [3, 3, 0, 1, 1], 9);
  const boundary = await makeQuiz("boundary"); assert.equal((await settle(boundary, "boundary", 6000)).streakExp, 5);
  let player = await wallet("boundary");
  assert.equal(player.points, 9); assert.equal(player.bonusExp, 14); assert.equal(player.sparks, 26);
  assert.equal(experienceProgress(player.points, player.bonusExp).level, 2);
  assert.ok(achievementProgress(player).find(item => item.id === "level_2").unlocked);
  await exchangeSparks(randomUUID(), guildId, "boundary", 3);
  player = await wallet("boundary"); assert.equal(player.points, 9); assert.equal(player.bonusExp, 23); assert.equal(player.sparks, 23);
  stage = "finish-order-and-legacy";
  await seedHistory("delayed", [1, 1]);
  const later = await makeQuiz("later"); assert.equal((await settle(later, "delayed", 5000)).streakExp, 5);
  const earlyWrong = await makeQuiz("early-wrong"); await settle(earlyWrong, "delayed", 3000, false);
  const earlyCorrect = await makeQuiz("early-correct");
  assert.equal((await settle(earlyCorrect, "delayed", 4000)).streakExp, 0, "An older answer uses its own finish position, not the latest streak");
  assert.equal((await storedAnswer(later, "delayed")).streakExp, 5, "Delayed results do not take back awarded EXP");
  assert.equal((await wallet("delayed")).currentStreak, 2);
  assert.equal(await db.quizAnswer.count({ where: { guildId, userId: "delayed", messageId: { contains: "legacy" }, streakExp: { not: 0 } } }), 0);
  stage = "concurrent-once-only";
  await seedHistory("parallel", [1]); const parallel = await makeQuiz("parallel");
  const results = await Promise.all(Array.from({ length: 3 }, () => applyFinalVotes(parallel, [{ userId: "parallel", answerId: 1 }], new Date(2000))));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await wallet("parallel")).bonusExp, 0);
  const first = await makeQuiz("competing-a", guildId, "buttons"), second = await makeQuiz("competing-b", guildId, "buttons");
  await db.quizSettlement.update({ where: { messageId: first.messageId }, data: { expiresAt: new Date(3000) } });
  await db.quizSettlement.update({ where: { messageId: second.messageId }, data: { expiresAt: new Date(4000) } });
  await db.quizVote.createMany({ data: [first, second].map(quiz => ({ guildId, messageId: quiz.messageId, userId: "parallel", answerId: 1 })) });
  assert.ok((await Promise.all([applyFinalVotes(first, [{ userId: "parallel", answerId: 1 }], new Date(3000)),
    applyFinalVotes(second, [{ userId: "parallel", answerId: 1 }], new Date(4000))])).every(Boolean));
  const awarded = await db.quizAnswer.aggregate({ where: { guildId, userId: "parallel" }, _sum: { streakExp: true } });
  assert.equal((await wallet("parallel")).bonusExp, awarded._sum.streakExp);
  assert.equal((await storedAnswer(first, "parallel")).streakExp, 5);
  assert.equal((await storedAnswer(second, "parallel")).streakExp, 10);
  assert.equal((await wallet("parallel")).bonusExp, 15, "Worker order cannot reduce a closed button quiz's bonus");
  stage = "pending-closed-votes";
  await seedHistory("waiting", [1, 1]);
  const unscoredWrong = await makeQuiz("unscored-wrong", guildId, "buttons");
  await db.quizSettlement.update({ where: { messageId: unscoredWrong.messageId },
    data: { expiresAt: new Date(Date.now() + 3_600_000), closedAt: new Date(3000) } });
  await db.quizVote.create({ data: { guildId, messageId: unscoredWrong.messageId, userId: "waiting", answerId: 2 } });
  const afterWrong = await makeQuiz("after-pending-wrong", guildId, "buttons");
  assert.equal((await settle(afterWrong, "waiting", 4000)).streakExp, 0, "A closed wrong answer resets bonuses before its worker runs");
  await applyFinalVotes(unscoredWrong, [], new Date(3000));
  assert.equal((await wallet("waiting")).currentStreak, 1);
  const active = await makeQuiz("active-wrong", guildId, "buttons");
  await db.quizSettlement.update({ where: { messageId: active.messageId }, data: { expiresAt: new Date(Date.now() + 3_600_000) } });
  await db.quizVote.create({ data: { guildId, messageId: active.messageId, userId: "waiting", answerId: 2 } });
  const afterActive = await makeQuiz("after-active", guildId, "buttons");
  assert.equal((await settle(afterActive, "waiting", 5000)).streakExp, 0, "The second correct answer after a reset has no bonus");
  const thirdAfterActive = await makeQuiz("third-after-active", guildId, "buttons");
  assert.equal((await settle(thirdAfterActive, "waiting", 6000)).streakExp, 5, "An active wrong choice has not broken the streak yet");
  stage = "equal-finish-order";
  await seedHistory("tied", [1]);
  const tied = [await makeQuiz("tied-a", guildId, "buttons"), await makeQuiz("tied-b", guildId, "buttons")];
  for (const quiz of tied) await db.quizSettlement.update({ where: { messageId: quiz.messageId }, data: { expiresAt: new Date(2000) } });
  await db.quizVote.createMany({ data: tied.map(quiz => ({ guildId, messageId: quiz.messageId, userId: "tied", answerId: 1 })) });
  await applyFinalVotes(tied[1], [], new Date(2000)); await applyFinalVotes(tied[0], [], new Date(2000));
  assert.equal((await storedAnswer(tied[0], "tied")).streakExp, 0);
  assert.equal((await storedAnswer(tied[1], "tied")).streakExp, 5);
  assert.equal((await wallet("tied")).bonusExp, 5);
  stage = "storage-limit";
  await seedHistory("capped", [1, 1], maxWalletValue - 1);
  const capped = await makeQuiz("capped"); assert.equal((await settle(capped, "capped", 3000)).streakExp, 1);
  assert.equal((await wallet("capped")).bonusExp, maxWalletValue);
  const full = await makeQuiz("full"); assert.equal((await settle(full, "capped", 4000)).streakExp, 0);
  stage = "rollback";
  await seedHistory("rollback", [1, 1]); const failed = await makeQuiz("rollback");
  db.$transaction = (callback, options) => originalTransaction(tx => callback(new Proxy(tx, { get(target, property) {
    return property === "userScore" ? { findUnique: args => target.userScore.findUnique(args),
      upsert: async args => { await target.userScore.upsert(args); throw new Error("Injected post-bonus failure"); } } : target[property];
  } })), options);
  await assert.rejects(applyFinalVotes(failed, [{ userId: "rollback", answerId: 1 }], new Date(3000)), /Injected/);
  db.$transaction = originalTransaction;
  assert.equal((await wallet("rollback")).bonusExp, 0); assert.equal(await storedAnswer(failed, "rollback"), null);
  assert.equal((await db.quizSettlement.findUnique({ where: { messageId: failed.messageId } })).scoredAt, null);
  await settle(failed, "rollback", 3000); assert.equal((await wallet("rollback")).bonusExp, 5);
  console.log(JSON.stringify({ check: "streak-experience-postgres", passed: true, cappedBonus: true, onceOnly: true,
    levelsAndBadges: true, guildIsolation: true, privateResultLocales: messageLanguages.length, rollback: true, finishPosition: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "streak-experience-postgres", passed: false, stage,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-streak-experience-postgres\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  db.$transaction = originalTransaction; globalThis.fetch = originalFetch;
  await db.quizSettlement.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.$disconnect();
}
