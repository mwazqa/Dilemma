import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
const { db } = await import("../dist/db.js");
const { publishQuizResults } = await import("../dist/services/quiz-results.js");
const { closeQuiz } = await import("../dist/services/quiz-closure.js");
const guildId = `results-test-${randomUUID()}`;
const sends = [];
let failSend = false;
const client = { rest: { post: async (_, { body }) => {
  assert.equal(body.enforce_nonce, true); assert.deepEqual(body.allowed_mentions.parse, []);
  assert.ok(body.nonce.length <= 25);
  if (failSend) throw new Error("Synthetic send failure");
  await new Promise(resolve => setTimeout(resolve, 15));
  sends.push(body); return { id: `result-${sends.length}` };
} } };
try {
  for (const kind of ["generated", "random"]) {
    const messageId = `${guildId}-${kind}`;
    const common = { guildId, messageId, channelId: "fixture-channel", question: "Fixture question", options: JSON.stringify(["Saved answer", "Other"]),
      correctOption: 0, explanation: "Saved fact.", optionEmojis: "||" };
    const table = kind === "generated" ? db.generatedPoll : db.randomPoll;
    if (kind === "generated") await db.generatedPoll.create({ data: { ...common, topicId: "fixture-topic" } });
    else await db.randomPoll.create({ data: { ...common, language: "en" } });
    const quiz = await db.quizSettlement.create({ data: { messageId, guildId, channelId: common.channelId, difficulty: "hard", correctAnswerId: 17,
      answerIds: "17,93", expiresAt: new Date(0), scoredAt: new Date(), closedAt: new Date(0) } });
    assert.equal(quiz.resultsPending, true);
    failSend = true;
    await assert.rejects(publishQuizResults(client, quiz, "en"));
    assert.equal((await table.findUnique({ where: { messageId } })).endedAt, null, "Failed delivery rolls back the result claim");
    assert.equal((await db.quizSettlement.findUnique({ where: { messageId } })).resultsPending, true);
    failSend = false;
    const before = sends.length;
    const attempts = await Promise.all(Array.from({ length: 12 }, () => publishQuizResults(client, quiz, "en")));
    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal(sends.length, before + 1);
    assert.match(sends.at(-1).content, /Saved answer/);
    assert.match(sends.at(-1).content, /Saved fact/);
    const delivered = await db.quizSettlement.findUnique({ where: { messageId } });
    assert.equal(delivered.resultsPending, false); assert.equal(+delivered.scoredAt, +quiz.scoredAt);
    assert.ok((await table.findUnique({ where: { messageId } })).endedAt);
    assert.equal((await table.findUnique({ where: { messageId } })).closeSource, "automatic");

    const manualMessageId = `${messageId}-manual`;
    const manualCommon = { ...common, messageId: manualMessageId };
    if (kind === "generated") await table.create({ data: { ...manualCommon, topicId: "fixture-topic" } });
    else await table.create({ data: { ...manualCommon, language: "en" } });
    const manualQuiz = await db.quizSettlement.create({ data: { messageId: manualMessageId, guildId, channelId: common.channelId,
      difficulty: "hard", correctAnswerId: 17, answerIds: "17,93", expiresAt: new Date(Date.now() + 3_600_000) } });
    const futurePoll = { expiresTimestamp: Date.now() + 3_600_000, end: async () => { throw new Error("Synthetic close failure"); } };
    await assert.rejects(closeQuiz(manualQuiz, kind === "generated", "failed-actor", "button", futurePoll));
    const failed = await table.findUnique({ where: { messageId: manualMessageId } });
    assert.equal(failed.closedByUserId, null); assert.equal(failed.closedAt, null); assert.equal(failed.closeSource, null);
    assert.equal((await db.quizSettlement.findUnique({ where: { messageId: manualMessageId } })).closedAt, null);
    assert.equal(await closeQuiz({ ...manualQuiz, guildId: "other-guild" }, kind === "generated", "wrong-guild", "button", futurePoll), null);
    assert.equal(await closeQuiz({ ...manualQuiz, channelId: "other-channel" }, kind === "generated", "wrong-channel", "button", futurePoll), null);
    let endCalls = 0;
    futurePoll.end = async () => { endCalls++; await new Promise(resolve => setTimeout(resolve, 15)); };
    const closures = await Promise.all(Array.from({ length: 12 }, (_, index) => closeQuiz(manualQuiz, kind === "generated",
      `actor-${index}`, index % 2 ? "command" : "button", futurePoll)));
    const winner = closures.findIndex(Boolean);
    assert.equal(closures.filter(Boolean).length, 1); assert.equal(endCalls, 1);
    const audit = await table.findUnique({ where: { messageId: manualMessageId } });
    assert.equal(audit.closedByUserId, `actor-${winner}`); assert.equal(audit.closeSource, winner % 2 ? "command" : "button");
    assert.equal(+audit.closedAt, +closures[winner]);
    assert.equal(+(await db.quizSettlement.findUnique({ where: { messageId: manualMessageId } })).closedAt, +audit.closedAt);
    failSend = true;
    await assert.rejects(publishQuizResults(client, manualQuiz, "en"));
    assert.equal((await table.findUnique({ where: { messageId: manualMessageId } })).closedByUserId, audit.closedByUserId);
    failSend = false;
    await publishQuizResults(client, manualQuiz, "en");
    assert.ok(sends.at(-1).content.includes(`<@${audit.closedByUserId}>`));
    assert.ok(sends.at(-1).content.includes(`<t:${Math.floor(+audit.closedAt / 1000)}:f>`));
    assert.equal(await closeQuiz(manualQuiz, kind === "generated", "late-actor", "command", futurePoll), null);
    assert.equal((await table.findUnique({ where: { messageId: manualMessageId } })).closedByUserId, audit.closedByUserId);

    const raceMessageId = `${messageId}-race`;
    if (kind === "generated") await table.create({ data: { ...common, messageId: raceMessageId, topicId: "fixture-topic" } });
    else await table.create({ data: { ...common, messageId: raceMessageId, language: "en" } });
    const raceQuiz = await db.quizSettlement.create({ data: { messageId: raceMessageId, guildId, channelId: common.channelId,
      difficulty: "hard", correctAnswerId: 17, answerIds: "17,93", expiresAt: new Date(Date.now() + 3_600_000) } });
    let enteredEnd, releaseEnd;
    const entered = new Promise(resolve => { enteredEnd = resolve; });
    const release = new Promise(resolve => { releaseEnd = resolve; });
    const manual = closeQuiz(raceQuiz, kind === "generated", "race-actor", "button", {
      expiresTimestamp: Date.now() + 3_600_000, end: async () => { enteredEnd(); await release; }
    });
    await entered;
    const automatic = publishQuizResults(client, raceQuiz, "en");
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseEnd();
    await Promise.all([manual, automatic]);
    assert.ok(sends.at(-1).content.includes("<@race-actor>"), "Automatic delivery waits for the confirmed manual actor");
    assert.equal((await table.findUnique({ where: { messageId: raceMessageId } })).closedByUserId, "race-actor");
  }
  console.log(JSON.stringify({ check: "automatic-results-postgres", passed: true, concurrentRequests: 12,
    scheduledAndRandom: true, singleDelivery: true, failedSendRollback: true, persistedDeliveryState: true, scoredAtPreserved: true,
    closureAudit: true, concurrentActors: true, failedCloseRollback: true, actorPreservedAfterRetry: true, guildAndChannelIsolation: true }));
} catch {
  console.error("Isolated automatic results test failed. Raw output withheld.");
  process.exitCode = 1;
} finally {
  await db.quizSettlement.deleteMany({ where: { guildId } });
  await db.generatedPoll.deleteMany({ where: { guildId } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.$disconnect();
}
