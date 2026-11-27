import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
const ownerId = "111111111111111111";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", QUIZ_REPORT_RECIPIENT_ID: ownerId });
const { db } = await import("../dist/db.js");
const { approveQuizCorrection } = await import("../dist/services/quiz-corrections.js");
const { handleQuizCorrectionButton, handleQuizCorrectionModal } = await import("../dist/commands/quiz-correction.js");
const { reportAnalysisScopeKey } = await import("../dist/services/quiz-report-analysis.js");
const { quizPersonalPayload } = await import("../dist/services/quiz-personal.js");
const { buttonSettlementData, castQuizVote, useQuizTool, placeQuizWager } = await import("../dist/services/quiz-voting.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const { generationRuleKey } = await import("../dist/services/quiz-generation-rules.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const guildId = String(BigInt(Date.now()) * 100_000n + BigInt(randomInt(90_000)));
const otherGuild = String(BigInt(guildId) + 1_000_000n);
const quiz = { guildId, messageId: String(BigInt(guildId) + 2n), channelId: String(BigInt(guildId) + 1n) };
const options = JSON.stringify(["Alpha", "Beta", "Gamma"]);
const poll = { ...quiz, question: "Which answer is correct?", options, explanation: "An incorrect fact.", correctOption: 0 };
const proposal = "Public correction proposed by the reviewer.";
const update = "The original explanation was incorrect. Beta is the accepted answer.";
const suggestedRule = `State the edition when an answer varies between editions (fixture ${guildId.slice(-8)}).`;
const editedRule = `Specify the scope when multiple answers may be valid (fixture ${guildId.slice(-8)}).`;
const ruleKey = text => ({ key: generationRuleKey(text) });
const analysis = { kind: "factual", verdict: "confirmed", finding: "The fact is wrong.", suggestion: proposal, generationRule: suggestedRule, sources: [] };
const score = (userId, guild = guildId) => db.userScore.findUniqueOrThrow({ where: { guildId_userId: { guildId: guild, userId } } });
const balance = async (userId, guild = guildId) => (await score(userId, guild)).sparks;
const answer = (messageId, userId) => db.quizAnswer.findUniqueOrThrow({ where: { messageId_userId: { messageId, userId } } });
const fee = async userId => (await db.quizCharge.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId } } }))?.fees ?? 0;
const setBalance = (userId, sparks) => db.userScore.update({ where: { guildId_userId: { guildId, userId } }, data: { sparks } });
const originalTransaction = db.$transaction.bind(db);
let stage = "prepare";

async function report(kind = "factual", reporterUserId = "reporter", snapshot = poll) {
  const facts = { ...snapshot, reason: "Private reporter context: the stated fact is inaccurate." };
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
  assert.equal((await approveQuizCorrection(wording.id)).status, "unavailable");
  assert.equal(await db.quizGenerationRule.count({ where: ruleKey(suggestedRule) }), 0);

  stage = "charges";
  await castQuizVote(quiz, "loser", 1);
  await castQuizVote(quiz, "loser", 2);
  await castQuizVote(quiz, "loser", 2);
  await useQuizTool(quiz, "loser", "reveal");
  await useQuizTool(quiz, "loser", "reveal");
  await useQuizTool(quiz, "loser", "fifty");
  assert.equal((await placeQuizWager(quiz, "loser", 10)).status, "placed");
  await castQuizVote(quiz, "winner", 1);
  assert.equal((await placeQuizWager(quiz, "winner", 10)).status, "placed");
  await useQuizTool(quiz, "winner", "reveal");
  await castQuizVote(quiz, "withdrawn", 2);
  assert.equal((await placeQuizWager(quiz, "withdrawn", 10)).status, "placed");
  await castQuizVote(quiz, "withdrawn", null);
  await db.quizSupport.create({ data: { messageId: quiz.messageId, guildId, userId: "legacy", revealed: true, hintAnswerIds: "1,2" } });
  assert.deepEqual(await Promise.all([fee("loser"), fee("winner"), fee("withdrawn"), fee("legacy")]), [1, 0, 1, 0]);
  await db.quizCharge.update({ where: { messageId_userId: { messageId: quiz.messageId, userId: "loser" } }, data: { fees: { increment: 3 } } });
  await setBalance("loser", await balance("loser") - 3);
  const finishedAt = new Date();
  const closed = await db.quizSettlement.update({ where: { messageId: quiz.messageId }, data: { closedAt: finishedAt } });
  assert.equal(await applyFinalVotes(closed, [], finishedAt), true);
  assert.deepEqual(await Promise.all(["loser", "winner", "withdrawn", "legacy"].map(id => balance(id))), [3, 32, 19, 20]);
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
  assert.equal(modal.components[1].components[0].value, suggestedRule);
  const submission = { ...interaction, customId: modal.custom_id, isFromMessage: () => true,
    fields: { fields: new Set(["generation-rule"]), getTextInputValue: id => id === "generation-rule" ? editedRule : update },
    deferReply: async () => {}, editReply: async value => { feedback = value.content; } };
  await handleQuizCorrectionModal({ ...submission, guildId });
  assert.equal(await db.quizCorrection.count({ where: { messageId: quiz.messageId } }), 0);

  stage = "atomic-refund";
  assert.equal((await approveQuizCorrection(factual.id, update, "Check the claim https://example.test/private")).status, "invalid-rule");
  await setBalance("loser", 2_147_483_647);
  assert.equal((await approveQuizCorrection(factual.id, update)).status, "balance-limit");
  assert.equal(await balance("winner"), 32);
  await setBalance("loser", 3);
  db.$transaction = (work, options) => originalTransaction(tx => work(new Proxy(tx, { get(target, key) {
    return key === "quizRefund" ? { createMany: async () => { throw Error("Synthetic failure before receipt"); } } : target[key];
  } })), options);
  await assert.rejects(approveQuizCorrection(factual.id, update, editedRule), /Synthetic failure/);
  db.$transaction = originalTransaction;
  assert.equal(await balance("loser"), 3);
  assert.equal(await db.quizCorrection.count({ where: { messageId: quiz.messageId } }), 0);
  assert.equal(await db.quizGenerationRule.count({ where: ruleKey(editedRule) }), 0);
  assert.equal((await answer(quiz.messageId, "loser")).streakProtected, false);
  await Promise.all([handleQuizCorrectionModal(submission), approveQuizCorrection(factual.id, update, editedRule)]);
  assert.ok(feedback);
  assert.equal((await db.quizGenerationRule.findUniqueOrThrow({ where: ruleKey(editedRule) })).text, editedRule);
  assert.equal(await db.quizGenerationRule.count({ where: ruleKey(suggestedRule) }), 0);
  const saved = await db.quizCorrection.findUniqueOrThrow({ where: { messageId: quiz.messageId } });
  assert.equal(saved.text, update);
  assert.equal(saved.refundedSparks, 18n);
  assert.equal(saved.refundedPlayers, 2);
  assert.deepEqual(await Promise.all(["loser", "winner", "withdrawn", "legacy"].map(id => balance(id))), [20, 32, 20, 20]);
  assert.deepEqual(await db.userScore.findUniqueOrThrow({ where: winnerWallet }), originalWinner);
  assert.equal(await db.quizRefund.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId: "winner" } } }), null);
  assert.equal((await db.quizWager.findUniqueOrThrow({ where: { messageId_userId: { messageId: quiz.messageId, userId: "winner" } } })).payout, 20);
  assert.equal(await balance("loser", otherGuild), 50);
  const duplicate = await approveQuizCorrection(factual.id, "A later duplicate should not change the approved correction.");
  assert.equal(duplicate.status, "already");
  assert.equal(await balance("loser"), 20);

  stage = "private-result";
  const result = await quizPersonalPayload(quiz, "loser", "en");
  assert.ok(result.content.includes(update));
  assert.ok(result.content.includes("17 ✦"));
  assert.ok(!result.content.includes("Private reporter context"));
  assert.ok(!result.content.includes(editedRule));

  stage = "one-click-approval";
  const nextQuiz = { ...quiz, messageId: String(BigInt(quiz.messageId) + 10n) };
  await db.quizSettlement.create({ data: buttonSettlementData(nextQuiz, "easy", 3, 0, new Date(Date.now() + 60 * 60_000)) });
  const nextPoll = { ...poll, messageId: nextQuiz.messageId };
  await db.randomPoll.create({ data: { ...nextPoll, language: "en", difficulty: "easy" } });
  const ready = await report("factual", "other-reporter", nextPoll);
  await db.userScore.create({ data: { guildId, userId: "direct-voter", sparks: 20 } });
  await castQuizVote(nextQuiz, "direct-voter", 2);
  await placeQuizWager(nextQuiz, "direct-voter", 2);
  const nextFinishedAt = new Date();
  const closedNext = await db.quizSettlement.update({ where: { messageId: nextQuiz.messageId }, data: { closedAt: nextFinishedAt } });
  assert.equal(await applyFinalVotes(closedNext, [], nextFinishedAt), true);
  assert.equal(await balance("direct-voter"), 16);
  const click = { ...interaction, customId: `quiz:accept-correction:${ready.id}`, deferReply: async () => {},
    showModal: async () => assert.fail("Accepting the proposal must not open a form"),
    editReply: async value => { feedback = value.content; } };
  await handleQuizCorrectionButton({ ...click, user: { bot: false, id: "other" } });
  assert.equal(await balance("direct-voter"), 16);
  await handleQuizCorrectionButton(click);
  assert.equal((await db.quizGenerationRule.findUniqueOrThrow({ where: ruleKey(suggestedRule) })).text, suggestedRule);
  const approved = await db.quizCorrection.findUniqueOrThrow({ where: { messageId: nextQuiz.messageId } });
  assert.equal(approved.text, proposal);
  assert.equal(approved.publishedAt, null);
  assert.equal(approved.refundedSparks, 4n);
  assert.equal(await balance("direct-voter"), 20);
  await handleQuizCorrectionButton(click);
  assert.equal(await balance("direct-voter"), 20);

  stage = "streak-recovery";
  const affected = ["zero-balance", "later-error"];
  const correctVotes = [...affected, "original-winner"].map(userId => ({ userId, answerId: 1 }));
  async function settleStreakQuiz(index, votes) {
    const messageId = String(BigInt(guildId) + 100n + BigInt(index));
    const finishedAt = new Date(index * 1000);
    const settled = await db.quizSettlement.create({ data: { guildId, channelId: quiz.channelId, messageId,
      difficulty: "easy", correctAnswerId: 1, answerIds: "1,2,3", expiresAt: finishedAt } });
    assert.equal(await applyFinalVotes(settled, votes, finishedAt), true);
    return settled;
  }
  await settleStreakQuiz(1, correctVotes);
  await settleStreakQuiz(2, correctVotes);
  await setBalance("zero-balance", 0);
  const disputed = await settleStreakQuiz(3, correctVotes.map(vote => ({ ...vote, answerId: affected.includes(vote.userId) ? 2 : 1 })));
  await settleStreakQuiz(4, correctVotes);
  await settleStreakQuiz(5, [{ userId: "later-error", answerId: 2 }]);
  const disputedPoll = { ...poll, messageId: disputed.messageId };
  await db.randomPoll.create({ data: { ...disputedPoll, language: "en", difficulty: "easy" } });
  const streakReport = await report("factual", "streak-reporter", disputedPoll);
  assert.equal((await score("zero-balance")).currentStreak, 1);
  assert.equal((await answer(disputed.messageId, "zero-balance")).sparksPenalty, 0);
  const originalStreakWinner = await score("original-winner");
  const beforeRecovery = await score("zero-balance");
  assert.equal((await approveQuizCorrection(streakReport.id)).status, "approved");
  assert.equal(await db.quizGenerationRule.count({ where: ruleKey(suggestedRule) }), 1);
  const recovered = await score("zero-balance");
  assert.deepEqual([recovered.currentStreak, recovered.bestStreak], [3, 3]);
  assert.deepEqual([recovered.exp, recovered.correct, recovered.answered, recovered.sparks],
    [beforeRecovery.exp, beforeRecovery.correct, beforeRecovery.answered, beforeRecovery.sparks]);
  const laterError = await score("later-error");
  assert.deepEqual([laterError.currentStreak, laterError.bestStreak], [0, 3]);
  assert.deepEqual(await score("original-winner"), originalStreakWinner);
  assert.equal((await answer(disputed.messageId, "original-winner")).streakProtected, false);
  assert.equal(await db.quizRefund.count({ where: { messageId: disputed.messageId, userId: "zero-balance" } }), 0);
  for (const language of messageLanguages) {
    const confirmation = message(language, "quizCorrectionStreakProtected");
    assert.ok((await quizPersonalPayload(disputed, "zero-balance", language)).content.includes(confirmation));
    assert.ok(!(await quizPersonalPayload(disputed, "original-winner", language)).content.includes(confirmation));
  }
  const resumed = await settleStreakQuiz(6, correctVotes);
  assert.equal((await answer(resumed.messageId, "zero-balance")).streakExp, 10);
  assert.equal((await score("zero-balance")).currentStreak, 4);
  assert.equal((await answer(resumed.messageId, "later-error")).streakExp, 0);
  console.log(JSON.stringify({ check: "quiz-corrections", passed: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "quiz-corrections", passed: false, stage,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    code: typeof error?.code === "string" && /^(?:P\d{4}|ERR_ASSERTION)$/.test(error.code) ? error.code : undefined,
    line: error?.stack?.match(/test-quiz-corrections-postgres\.mjs:(\d+)/)?.[1] }));
  process.exitCode = 1;
} finally {
  db.$transaction = originalTransaction;
  await db.quizGenerationRule.deleteMany({ where: { key: { in: [generationRuleKey(suggestedRule), generationRuleKey(editedRule)] } } });
  await db.quizSettlement.deleteMany({ where: { guildId } });
  await db.quizReport.deleteMany({ where: { guildId } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.quizWeeklyToolUse.deleteMany({ where: { guildId } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.$disconnect();
}
