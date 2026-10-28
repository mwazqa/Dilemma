import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
const { db } = await import("../dist/db.js");
const { publishQuizResults } = await import("../dist/services/quiz-results.js");
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
  }
  console.log(JSON.stringify({ check: "automatic-results-postgres", passed: true, concurrentRequests: 12,
    scheduledAndRandom: true, singleDelivery: true, failedSendRollback: true, persistedDeliveryState: true, scoredAtPreserved: true }));
} catch {
  console.error("Isolated automatic results test failed. Raw output withheld.");
  process.exitCode = 1;
} finally {
  await db.quizSettlement.deleteMany({ where: { guildId } });
  await db.generatedPoll.deleteMany({ where: { guildId } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.$disconnect();
}
