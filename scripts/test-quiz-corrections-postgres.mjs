import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
const ownerId = "111111111111111111";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", QUIZ_REPORT_RECIPIENT_ID: ownerId });
const { db } = await import("../dist/db.js");
const { approveQuizCorrection } = await import("../dist/services/quiz-corrections.js");
const { handleQuizCorrectionButton, handleQuizCorrectionModal } = await import("../dist/commands/quiz-correction.js");
const { publishQuizCorrection } = await import("../dist/services/quiz-correction-notices.js");
const { reportAnalysisScopeKey } = await import("../dist/services/quiz-report-analysis.js");
const { quizPersonalPayload } = await import("../dist/services/quiz-personal.js");
const { buttonSettlementData, castQuizVote, useQuizTool, placeQuizWager } = await import("../dist/services/quiz-voting.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const guildId = String(BigInt(Date.now()) * 100_000n + BigInt(randomInt(90_000)));
const otherGuild = String(BigInt(guildId) + 1_000_000n);
const quiz = { guildId, messageId: String(BigInt(guildId) + 2n), channelId: String(BigInt(guildId) + 1n) };
const options = JSON.stringify(["Alpha", "Beta", "Gamma"]);
const poll = { ...quiz, question: "Which answer is correct?", options, explanation: "An incorrect fact.", correctOption: 0 };
const proposal = "Public correction proposed by the reviewer.";
const update = "The original explanation was incorrect. Beta is the accepted answer.";
const analysis = { kind: "factual", verdict: "confirmed", finding: "The fact is wrong.", suggestion: proposal, sources: [] };
const balance = async (userId, guild = guildId) => (await db.userScore.findUniqueOrThrow({ where: { guildId_userId: { guildId: guild, userId } } })).sparks;
const fee = async userId => (await db.quizCharge.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId } } }))?.fees ?? 0;
const setBalance = (userId, sparks) => db.userScore.update({ where: { guildId_userId: { guildId, userId } }, data: { sparks } });
const originalTransaction = db.$transaction.bind(db);
let stage = "prepare";

async function report(kind = "factual", reporterUserId = "reporter") {
  const facts = { ...poll, reason: "Private reporter context: the stated fact is inaccurate." };
  return db.quizReport.create({ data: { ...facts, reporterUserId, source: "random", difficulty: "medium", quizCreatedAt: new Date(),
    reviewedAt: new Date(), analysis: JSON.stringify({ scopeKey: reportAnalysisScopeKey(facts), analysis: { ...analysis, kind } }) } });
}

try {
  await db.quizSettlement.create({ data: buttonSettlementData(quiz, "medium", 3, 0, new Date(Date.now() + 60 * 60_000)) });
  await db.randomPoll.create({ data: { ...poll, language: "en", difficulty: "medium" } });
  await db.userScore.createMany({ data: [
    ...["loser", "winner", "withdrawn", "legacy"].map(userId => ({ guildId, userId, sparks: 20 })),
    { guildId: otherGuild, userId: "loser", sparks: 50 }
  ] });
  const factual = await report();
  const wording = await report("wording", "wording-reporter");
  assert.equal((await approveQuizCorrection(factual.id, "  ")).status, "invalid");
  assert.equal((await approveQuizCorrection("missing-report", update)).status, "unavailable");
  assert.equal((await approveQuizCorrection(factual.id, update)).status, "pending");

  stage = "charges";
  await castQuizVote(quiz, "loser", 1);
  await castQuizVote(quiz, "loser", 2);
  await castQuizVote(quiz, "loser", 2);
  await useQuizTool(quiz, "loser", "reveal");
  await useQuizTool(quiz, "loser", "reveal");
  await useQuizTool(quiz, "loser", "fifty");
  await placeQuizWager(quiz, "loser", 4);
  await castQuizVote(quiz, "winner", 1);
  await placeQuizWager(quiz, "winner", 5);
  await useQuizTool(quiz, "winner", "reveal");
  await castQuizVote(quiz, "withdrawn", 2);
  await placeQuizWager(quiz, "withdrawn", 4);
  await castQuizVote(quiz, "withdrawn", null);
  await db.quizSupport.create({ data: { messageId: quiz.messageId, guildId, userId: "legacy", revealed: true, hintAnswerIds: "1,2" } });
  assert.deepEqual(await Promise.all([fee("loser"), fee("winner"), fee("withdrawn"), fee("legacy")]), [9, 3, 1, 0]);
  const finishedAt = new Date();
  const closed = await db.quizSettlement.update({ where: { messageId: quiz.messageId }, data: { closedAt: finishedAt } });
  assert.equal(await applyFinalVotes(closed, [], finishedAt), true);
  assert.deepEqual(await Promise.all(["loser", "winner", "withdrawn", "legacy"].map(id => balance(id))), [4, 24, 19, 20]);
  const winnerWallet = { guildId_userId: { guildId, userId: "winner" } };
  const originalWinner = await db.userScore.findUniqueOrThrow({ where: winnerWallet });

  stage = "owner-confirmation";
  let modal;
  let feedback;
  const interaction = { guildId: null, user: { bot: false, id: ownerId }, message: { author: { id: "bot" } }, client: { user: { id: "bot" } },
    customId: `quiz:correct:${factual.id}`, showModal: async value => { modal = value.toJSON(); }, reply: async value => { feedback = value.content; } };
  await handleQuizCorrectionButton({ ...interaction, user: { bot: false, id: "other" } });
  assert.equal(modal, undefined);
  await handleQuizCorrectionButton({ ...interaction, customId: `quiz:correct:${wording.id}` });
  assert.equal(modal.components[0].components[0].value, undefined);
  await handleQuizCorrectionButton(interaction);
  assert.equal(modal.components[0].components[0].value, proposal);
  const submission = { ...interaction, customId: modal.custom_id, isFromMessage: () => true,
    fields: { getTextInputValue: () => update }, deferReply: async () => {}, editReply: async value => { feedback = value.content; } };
  await handleQuizCorrectionModal({ ...submission, guildId });
  assert.equal(await db.quizCorrection.count({ where: { messageId: quiz.messageId } }), 0);

  stage = "atomic-refund";
  await setBalance("loser", 2_147_483_647);
  assert.equal((await approveQuizCorrection(factual.id, update)).status, "balance-limit");
  assert.equal(await balance("winner"), 24);
  await setBalance("loser", 4);
  db.$transaction = (work, options) => originalTransaction(tx => work(new Proxy(tx, { get(target, key) {
    return key === "quizRefund" ? { createMany: async () => { throw Error("Synthetic failure before receipt"); } } : target[key];
  } })), options);
  await assert.rejects(approveQuizCorrection(factual.id, update), /Synthetic failure/);
  db.$transaction = originalTransaction;
  assert.equal(await balance("loser"), 4);
  assert.equal(await db.quizCorrection.count({ where: { messageId: quiz.messageId } }), 0);
  await Promise.all([handleQuizCorrectionModal(submission), approveQuizCorrection(factual.id, update)]);
  assert.ok(feedback);
  const saved = await db.quizCorrection.findUniqueOrThrow({ where: { messageId: quiz.messageId } });
  assert.equal(saved.text, update);
  assert.equal(saved.refundedSparks, 17n);
  assert.equal(saved.refundedPlayers, 2);
  assert.deepEqual(await Promise.all(["loser", "winner", "withdrawn", "legacy"].map(id => balance(id))), [20, 24, 20, 20]);
  assert.deepEqual(await db.userScore.findUniqueOrThrow({ where: winnerWallet }), originalWinner);
  assert.equal(await db.quizRefund.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId: "winner" } } }), null);
  assert.equal((await db.quizWager.findUniqueOrThrow({ where: { messageId_userId: { messageId: quiz.messageId, userId: "winner" } } })).payout, 10);
  assert.equal(await balance("loser", otherGuild), 50);
  const duplicate = await approveQuizCorrection(factual.id, "A later duplicate should not change the approved correction.");
  assert.equal(duplicate.status, "already");
  assert.equal(await balance("loser"), 20);

  stage = "publication";
  const posts = [];
  let fail = true;
  const client = { rest: { post: async (route, { body }) => {
    assert.equal(route, `/channels/${quiz.channelId}/messages`);
    posts.push(body);
    if (fail) throw Error("Synthetic Discord delivery failure");
  } } };
  await assert.rejects(publishQuizCorrection(client, quiz.messageId), /Synthetic Discord/);
  assert.equal((await db.quizCorrection.findUniqueOrThrow({ where: { messageId: quiz.messageId } })).publishedAt, null);
  fail = false;
  assert.equal(await publishQuizCorrection(client, quiz.messageId), true);
  assert.equal(await publishQuizCorrection(client, quiz.messageId), false);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].nonce, posts[1].nonce);
  assert.deepEqual(posts[1].allowed_mentions, { parse: [] });
  assert.ok(posts[1].content.includes(update));
  assert.ok(!posts[1].content.includes("Private reporter context"));
  const result = await quizPersonalPayload(quiz, "loser", "en");
  assert.ok(result.content.includes(update));
  assert.ok(result.content.includes("16 ✦"));
  console.log(JSON.stringify({ check: "quiz-corrections", passed: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "quiz-corrections", passed: false, stage,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    code: typeof error?.code === "string" && /^(?:P\d{4}|ERR_ASSERTION)$/.test(error.code) ? error.code : undefined,
    line: error?.stack?.match(/test-quiz-corrections-postgres\.mjs:(\d+)/)?.[1] }));
  process.exitCode = 1;
} finally {
  db.$transaction = originalTransaction;
  await db.quizSettlement.deleteMany({ where: { guildId } });
  await db.quizReport.deleteMany({ where: { guildId } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.$disconnect();
}
