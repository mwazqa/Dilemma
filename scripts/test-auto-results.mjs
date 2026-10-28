import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { runDueSettlements, startScoreScheduler } = await import("../dist/services/scoring.js");
const { publishQuizResults } = await import("../dist/services/quiz-results.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const { settlementDeadline } = await import("../dist/services/schedule-events.js");
const { getResultMessage } = await import("../dist/brand.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { quizClosureSummary } = await import("../dist/services/quiz-closure.js");

let quiz, poll, answers, score, results, finalized, language, random, zeroVotes, failPost, failCommit, voterReads;
let serial = Promise.resolve();
const delivered = new Map();
function reset() {
  clearGuildSettingsCache();
  quiz = { messageId: "poll", guildId: "guild", channelId: "channel", difficulty: "hard", correctAnswerId: 17, answerIds: "17,93",
    expiresAt: new Date(0), nextCheckAt: new Date(0), closedAt: null, scoredAt: null, resultsPending: true };
  poll = { messageId: "poll", guildId: "guild", channelId: "channel", difficulty: "hard", options: JSON.stringify(["Alpha||Beta", "Gamma"]),
    correctOption: 0, explanation: "Saved fact.", optionEmojis: "||", endedAt: null,
    closedAt: null, closedByUserId: null, closeSource: null };
  answers = []; score = null; results = []; delivered.clear();
  finalized = true; language = "pl"; random = false; zeroVotes = failPost = failCommit = false; voterReads = 0;
}
db.quizSettlement.findMany = async () => !quiz.scoredAt || quiz.resultsPending ? [{ ...quiz }] : [];
db.quizSettlement.findUnique = async () => ({ ...quiz });
db.quizSettlement.updateMany = async ({ where, data }) => {
  if ((where.scoredAt === null && quiz.scoredAt) || (where.resultsPending === true && !quiz.resultsPending)) return { count: 0 };
  Object.assign(quiz, data); return { count: 1 };
};
db.generatedPoll.findUnique = async () => random ? null : { ...poll };
db.randomPoll.findUnique = async () => random ? { ...poll } : null;
db.generatedPoll.updateMany = db.randomPoll.updateMany = async ({ data }) => {
  if (poll.endedAt) return { count: 0 };
  Object.assign(poll, data); return { count: 1 };
};
db.guildSettings.findUnique = async () => ({ guildId: "guild", language, defaultDifficulty: "easy" });
db.topic.findUnique = async () => { throw new Error("Published results must not read changed topic settings"); };
db.quizAnswer.create = async ({ data }) => { answers.push(data); return data; };
db.quizAnswer.findMany = async () => answers;
db.userScore.upsert = async ({ create }) => { score = create; return create; };
db.$transaction = (work, options) => {
  const next = serial.then(async () => {
    const before = structuredClone({ quiz, poll, answers, score });
    try {
      const result = await work(db);
      if (failCommit && options.timeout === 15_000) {
        failCommit = false;
        throw new Prisma.PrismaClientKnownRequestError("Synthetic serialization failure", { code: "P2034", clientVersion: "test" });
      }
      return result;
    } catch (error) { ({ quiz, poll, answers, score } = before); throw error; }
  });
  serial = next.catch(() => {});
  return next;
};
const client = { user: { id: "bot" }, rest: {
  get: async route => {
    if (route.includes("/answers/")) { voterReads++; return { users: !zeroVotes && route.includes("/answers/17") ? [{ id: "user", bot: false }] : [] }; }
    return { id: "poll", channel_id: "channel", author: { id: "bot" }, poll: { allow_multiselect: false, expiry: new Date(0).toISOString(),
      answers: [{ answer_id: 17 }, { answer_id: 93 }], results: { is_finalized: finalized, answer_counts: [{ id: 17, count: zeroVotes ? 0 : 1 }, { id: 93, count: 0 }] } } };
  },
  post: async (route, { body }) => {
    assert.equal(route, "/channels/channel/messages"); assert.deepEqual(body.allowed_mentions.parse, []);
    assert.equal(body.enforce_nonce, true); assert.ok(body.nonce.length <= 25);
    if (failPost) throw new Error("Synthetic Discord send failure");
    if (!delivered.has(body.nonce)) { delivered.set(body.nonce, { id: "result" }); results.push(body.content); }
    return delivered.get(body.nonce);
  },
  patch: async (_, { body }) => { assert.equal(body.components[0].components[0].disabled, true); }
} };
try {
  for (const isRandom of [false, true]) for (const outputLanguage of messageLanguages) {
    reset(); random = isRandom; language = outputLanguage;
    finalized = false; await runDueSettlements(client);
    assert.equal(results.length, 0); assert.equal(quiz.scoredAt, null);
    finalized = true; await runDueSettlements(client);
    assert.equal(results.length, 1); assert.equal(results[0], getResultMessage(language, "Alpha||Beta", "Saved fact.", "") + "\n\n"
      + quizClosureSummary(language, { closedAt: new Date(0), closedByUserId: null, closeSource: "automatic" }));
    assert.equal(poll.closeSource, "automatic"); assert.equal(poll.closedByUserId, null);
    assert.equal(score.points, 3, "Changing the topic difficulty does not change an active quiz");
    assert.equal(quiz.resultsPending, false); assert.ok(quiz.scoredAt); assert.ok(poll.endedAt);
    await runDueSettlements(client); assert.equal(results.length, 1); assert.equal(answers.length, 1);
  }
  reset(); zeroVotes = true; await runDueSettlements(client);
  assert.equal(results.length, 1); assert.equal(answers.length, 0);
  for (const outputLanguage of messageLanguages) {
    reset(); language = outputLanguage;
    poll.closedAt = new Date(123_000); poll.closedByUserId = "original-actor"; poll.closeSource = "command";
    await runDueSettlements(client);
    assert.equal(poll.closedByUserId, "original-actor"); assert.equal(poll.closeSource, "command");
    assert.equal(+poll.closedAt, 123_000);
    assert.ok(results[0].includes(message(language, "quizClosedBy", { user: "<@original-actor>" })));
    assert.match(results[0], /<t:123:f>/);
  }
  reset(); quiz.expiresAt = new Date(3_600_000);
  await runDueSettlements(client);
  assert.equal(poll.closeSource, "unknown", "Unattributed early closure is never labeled automatic");
  assert.equal(poll.closedByUserId, null);
  assert.ok(results[0].includes(message(language, "quizClosureUnknown")));
  reset(); failPost = true; await runDueSettlements(client);
  assert.ok(quiz.scoredAt, "A result send failure must not lose points"); assert.equal(score.points, 3);
  assert.equal(quiz.resultsPending, true); assert.equal(poll.endedAt, null);
  const readsBeforeRetry = voterReads;
  failPost = false; quiz.nextCheckAt = new Date(0);
  const stop = startScoreScheduler(client);
  try { for (let attempt = 0; attempt < 100 && quiz.resultsPending; attempt++) await new Promise(resolve => setTimeout(resolve, 5)); }
  finally { stop(); }
  assert.equal(quiz.resultsPending, false); assert.equal(results.length, 1); assert.equal(answers.length, 1);
  assert.equal(voterReads, readsBeforeRetry, "Restart retries delivery without refetching or rescoring final votes");
  reset(); failCommit = true; await runDueSettlements(client);
  assert.equal(results.length, 1, "Retry after a Discord acknowledgement uses the same nonce"); assert.equal(quiz.resultsPending, false);
  reset();
  const manualSend = payload => client.rest.post("/channels/channel/messages", { body: { content: payload.content, allowed_mentions: payload.allowedMentions, nonce: payload.nonce, enforce_nonce: payload.enforceNonce } });
  await Promise.all([publishQuizResults(client, quiz, language, manualSend), runDueSettlements(client)]);
  assert.equal(results.length, 1, "Manual and automatic closing share one result claim"); assert.equal(answers.length, 1);
  assert.equal(settlementDeadline({ ...quiz, scoredAt: new Date(), resultsPending: true, nextCheckAt: new Date(123) }), 123);
  assert.equal(settlementDeadline({ ...quiz, scoredAt: new Date(), resultsPending: false }), null);
  console.log(JSON.stringify({ check: "automatic-quiz-results", passed: true, scheduledAndRandom: true, sixLanguages: true,
    zeroVotes: true, savedDifficulty: true, scoringIndependent: true, restartRecovery: true, concurrentClose: true, nonceRetry: true }));
} finally { await db.$disconnect(); }
