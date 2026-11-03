import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireTestDatabase } from "./test-database-guard.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const { buttonSettlementData, castQuizVote, placeQuizWager } = await import("../dist/services/quiz-voting.js");
const { quizPersonalPayload } = await import("../dist/services/quiz-personal.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const guildId = `penalties-${randomUUID()}`, otherGuild = `${guildId}-other`;
const transaction = db.$transaction.bind(db);
const key = (userId, guild = guildId) => ({ guildId_userId: { guildId: guild, userId } });
const wallet = async userId => (await db.userScore.findUnique({ where: key(userId) }))?.sparks;
const seed = (userId, sparks, guild = guildId) => db.userScore.create({ data: { guildId: guild, userId, sparks } });
const answer = (quiz, userId) => db.quizAnswer.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId } } });
async function quiz(name, difficulty) {
  const identity = { guildId, channelId: "test-channel", messageId: `${guildId}-${name}` };
  const settlement = await db.quizSettlement.create({ data: buttonSettlementData(identity, difficulty, 2, 0, new Date(Date.now() + 3_600_000)) });
  await db.randomPoll.create({ data: { ...identity, language: "en", question: "Synthetic question?", options: '["Correct","Wrong"]', correctOption: 0, explanation: "Synthetic fact." } });
  return settlement;
}
async function close(settlement) {
  await db.quizSettlement.update({ where: { messageId: settlement.messageId }, data: { closedAt: new Date() } });
}
let stage = "migration";
try {
  const migration = readFileSync("prisma/postgresql/migrations/20261103130000_answer_sparks_penalty/migration.sql", "utf8");
  const schema = `penalty_${randomUUID().replaceAll("-", "")}`;
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRawUnsafe('CREATE TABLE "QuizAnswer" ("points" INTEGER NOT NULL, "correct" BOOLEAN NOT NULL)');
    await tx.$executeRawUnsafe('INSERT INTO "QuizAnswer" VALUES (3, true), (0, false)');
    await tx.$executeRawUnsafe(migration);
    const rows = await tx.$queryRawUnsafe('SELECT "points", "correct", "sparksPenalty" FROM "QuizAnswer" ORDER BY "points"');
    assert.deepEqual(rows, [{ points: 0, correct: false, sparksPenalty: 0 }, { points: 3, correct: true, sparksPenalty: 0 }]);
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  });
  for (const [difficulty, penalty, reward] of [["easy", 2, 1], ["medium", 3, 2], ["hard", 4, 3]]) {
    stage = difficulty;
    const current = await quiz(difficulty, difficulty);
    const wrong = `${difficulty}-wrong`, poor = `${difficulty}-poor`, zero = `${difficulty}-zero`, newcomer = `${difficulty}-new`, correct = `${difficulty}-correct`, bettor = `${difficulty}-bet`, skip = `${difficulty}-skip`, withdrawn = `${difficulty}-withdrawn`;
    for (const [userId, sparks] of [[wrong, 10], [poor, 1], [zero, 0], [correct, 10], [bettor, 20], [skip, 10], [withdrawn, 10]]) await seed(userId, sparks);
    await seed(wrong, 50, otherGuild);
    for (const userId of [wrong, poor, zero, newcomer, bettor, withdrawn]) assert.equal((await castQuizVote(current, userId, 2)).status, "voted");
    await castQuizVote(current, correct, 1);
    await placeQuizWager(current, bettor, 10);
    await castQuizVote(current, withdrawn, null);
    assert.equal(await wallet(wrong), 10, "A vote alone does not charge an answer penalty");
    await close(current);
    const claims = await Promise.all(Array.from({ length: 3 }, () => applyFinalVotes(current, [], new Date())));
    assert.equal(claims.filter(Boolean).length, 1, "Concurrent settlement charges once");
    assert.equal(await wallet(wrong), 10 - penalty);
    assert.equal((await answer(current, wrong)).sparksPenalty, penalty);
    assert.equal((await answer(current, wrong)).points, 0);
    assert.equal((await db.userScore.findUnique({ where: key(wrong) })).currentStreak, 0);
    assert.equal(await wallet(poor), 0); assert.equal((await answer(current, poor)).sparksPenalty, 1);
    for (const userId of [zero, newcomer]) {
      assert.equal(await wallet(userId), 0); assert.equal((await answer(current, userId)).sparksPenalty, 0);
    }
    assert.equal(await wallet(correct), 10 + reward);
    assert.equal((await answer(current, correct)).sparksPenalty, 0);
    assert.equal((await answer(current, correct)).points, reward);
    assert.equal(await wallet(bettor), 10 - penalty, "Lost stake and wrong-answer penalty are separate");
    assert.equal((await db.quizWager.findUnique({ where: { messageId_userId: { messageId: current.messageId, userId: bettor } } })).payout, 0);
    assert.equal(await wallet(skip), 10); assert.equal(await answer(current, skip), null);
    assert.equal(await wallet(withdrawn), 9); assert.equal(await answer(current, withdrawn), null);
    assert.equal((await db.userScore.findUnique({ where: key(wrong, otherGuild) })).sparks, 50);
    for (const language of messageLanguages) for (const [userId, deducted] of [[wrong, penalty], [poor, 1], [zero, 0]]) {
      const panel = await quizPersonalPayload(current, userId, language);
      assert.ok(panel.content.includes(message(language, "quizAnswerLost", { points: 0, penalty: deducted })));
      assert.doesNotMatch(panel.content, /\{\w+\}/);
    }
    assert.equal(await applyFinalVotes(current, [], new Date()), false);
    assert.equal(await wallet(wrong), 10 - penalty);
  }
  stage = "concurrent-wallet";
  const first = await quiz("parallel-one", "hard"), second = await quiz("parallel-two", "hard");
  await seed("parallel", 3);
  for (const current of [first, second]) { await castQuizVote(current, "parallel", 2); await close(current); }
  assert.ok((await Promise.all([first, second].map(current => applyFinalVotes(current, [], new Date())))).every(Boolean));
  assert.equal(await wallet("parallel"), 0);
  assert.equal((await answer(first, "parallel")).sparksPenalty + (await answer(second, "parallel")).sparksPenalty, 3);
  stage = "rollback";
  const failed = await quiz("rollback", "hard");
  await seed("rollback", 10); await castQuizVote(failed, "rollback", 2); await close(failed);
  db.$transaction = (callback, options) => transaction(tx => callback(new Proxy(tx, { get(target, property) {
    return property === "userScore" ? {
      findUnique: args => target.userScore.findUnique(args),
      upsert: async args => { await target.userScore.upsert(args); throw new Error("Injected post-deduction failure"); }
    } : target[property];
  } })), options);
  await assert.rejects(applyFinalVotes(failed, [], new Date()), /Injected/);
  db.$transaction = transaction;
  assert.equal(await wallet("rollback"), 10); assert.equal(await answer(failed, "rollback"), null);
  assert.equal((await db.quizSettlement.findUnique({ where: { messageId: failed.messageId } })).scoredAt, null);
  assert.equal(await applyFinalVotes(failed, [], new Date()), true); assert.equal(await wallet("rollback"), 6);
  stage = "legacy";
  const legacy = await quiz("legacy-bet", "easy");
  await seed("legacy-bet", 0); await castQuizVote(legacy, "legacy-bet", 1);
  await db.quizWager.create({ data: { guildId, messageId: legacy.messageId, userId: "legacy-bet", answerId: 1, amount: 20 } });
  await close(legacy); await applyFinalVotes(legacy, [], new Date());
  assert.equal(await wallet("legacy-bet"), 41, "Existing 20-Spark stakes keep their payout");
  const historical = await quiz("historical", "hard");
  await seed("historical", 10);
  await db.quizSettlement.update({ where: { messageId: historical.messageId }, data: { scoredAt: new Date(), closedAt: new Date() } });
  await db.quizAnswer.create({ data: { guildId, messageId: historical.messageId, userId: "historical", answerId: 2, correct: false, points: 0, finishedAt: new Date() } });
  assert.equal(await applyFinalVotes(historical, [], new Date()), false);
  assert.equal(await wallet("historical"), 10); assert.equal((await answer(historical, "historical")).sparksPenalty, 0);
  const native = await db.quizSettlement.create({ data: { guildId, messageId: `${guildId}-native`, channelId: "test-channel", difficulty: "medium", answerIds: "17,93", correctAnswerId: 17, expiresAt: new Date(0) } });
  await seed("native", 10); await applyFinalVotes(native, [{ userId: "native", answerId: 93 }], new Date());
  assert.equal(await wallet("native"), 7); assert.equal((await answer(native, "native")).sparksPenalty, 3);
  console.log(JSON.stringify({ check: "sparks-penalties-postgres", passed: true, difficulties: 3, zeroFloor: true, onceOnly: true, concurrentWallet: true, rollback: true, skippedFree: true, actualPenaltyShown: true, legacyPreserved: true, nativeVoting: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "sparks-penalties-postgres", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "test-error", line: Number(error.stack?.match(/test-sparks-penalties-postgres\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  db.$transaction = transaction;
  await db.quizSettlement.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.$disconnect();
}
