import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { MessageFlags } from "discord.js";
import { deliverQuizReportReview, reviewQuizReports, safeReportText } from "./lib/quiz-report-review.mjs";
Object.assign(process.env, { DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { recordQuizReport } = await import("../dist/services/quiz-reports.js");
const { handleQuizReportButton, handleQuizReportModal } = await import("../dist/commands/quiz-report.js");
const { pollControls, REPORT_QUIZ_BUTTON_ID } = await import("../dist/services/poll-controls.js");
const { quizVotingPayload } = await import("../dist/services/quiz-voting.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const identity = { messageId: "quiz", guildId: "guild", channelId: "channel" };
const quiz = { ...identity, question: "Which number is even?", options: JSON.stringify(["2", "3"]), correctOption: 0,
  explanation: "Two is even.", difficulty: "hard", createdAt: new Date(0), endedAt: new Date(1) };
let language = "pl", random = false, writes = 0;
const reports = new Map();
db.guildSettings.findUnique = async () => ({ guildId: identity.guildId, language });
db.generatedPoll.findUnique = async ({ where }) => !random && where.messageId === identity.messageId ? { ...quiz } : null;
db.randomPoll.findUnique = async ({ where }) => random && where.messageId === identity.messageId ? { ...quiz } : null;
db.quizReport.create = async ({ data }) => {
  const key = data.messageId + data.reporterUserId;
  if (reports.has(key)) throw new Prisma.PrismaClientKnownRequestError("Synthetic duplicate", { code: "P2002", clientVersion: "test" });
  writes++;
  const report = { ...data, id: "c" + String(writes).padStart(24, "0"), createdAt: new Date(), reviewedAt: null };
  reports.set(key, report); return report;
};
db.quizReport.findUnique = async ({ where }) => reports.get(where.messageId_reporterUserId.messageId + where.messageId_reporterUserId.reporterUserId) ?? null;
for (const delegate of [db.userScore, db.quizVote, db.quizWager]) {
  for (const method of ["create", "update", "updateMany", "upsert", "delete"]) delegate[method] = async () => { throw Error("Reporting cannot change gameplay"); };
}
function interaction(overrides = {}) {
  const result = { replies: [], modal: null };
  return { ...identity, customId: REPORT_QUIZ_BUTTON_ID, locale: "en", user: { id: "player", bot: false },
    client: { user: { id: "bot" } }, message: { id: identity.messageId, author: { id: "bot" }, flags: { has: () => false } },
    isFromMessage: () => true, fields: { getTextInputValue: () => "The explanation needs a source." },
    reply: async payload => { assert.equal(payload.flags, MessageFlags.Ephemeral); result.replies.push(payload); },
    showModal: async value => { result.modal = value.toJSON(); },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => { assert.deepEqual(payload.allowedMentions, { parse: [] }); result.replies.push(payload); },
    ...overrides, result };
}
let stage = "reporting";
try {
  for (language of messageLanguages) for (random of [false, true]) {
    reports.clear(); clearGuildSettingsCache();
    const request = interaction();
    await handleQuizReportButton(request);
    assert.equal(request.result.modal.custom_id, "quiz:report:quiz");
    assert.equal(request.result.modal.title, message(language, "quizReportTitle"));
    assert.equal(request.result.modal.components[0].components[0].min_length, 10);
    assert.equal(request.result.modal.components[0].components[0].max_length, 1000);
    const before = writes;
    assert.equal(reports.size, 0, "Opening and closing a modal does not submit a report");
    const modal = interaction({ customId: "quiz:report:quiz" });
    await handleQuizReportModal(modal);
    assert.equal(writes, before + 1);
    assert.equal(modal.result.replies[0].content, message(language, "quizReportSaved"));
    assert.ok(modal.result.replies[0].content.includes(feedbackKaomoji.quizReportSaved));
    assert.ok(!modal.result.replies[0].content.includes(quiz.explanation), "Reporting never reveals the correct answer");
    const stored = [...reports.values()][0];
    assert.equal(stored.source, random ? "random" : "topic");
    assert.equal(stored.correctOption, 0); assert.equal(stored.question, quiz.question);
    await handleQuizReportModal(modal);
    assert.equal(writes, before + 1);
    assert.equal(modal.result.replies.at(-1).content, message(language, "quizReportExisting"));
    const rows = pollControls(language, true).flatMap(row => row.toJSON().components);
    assert.equal(rows.find(button => button.custom_id === REPORT_QUIZ_BUTTON_ID).disabled, undefined);
    assert.equal(rows[0].disabled, true, "Reporting stays available after closing");
    const payload = await quizVotingPayload({ question: quiz.question, options: ["2", "3"], optionEmojis: [] }, new Date(3600000), language, false, "hard");
    const buttons = payload.components.flatMap(row => row.toJSON().components);
    assert.equal(buttons.find(button => button.custom_id === REPORT_QUIZ_BUTTON_ID).label, message(language, "quizReportButton"));
    assert.ok(payload.embeds[0].toJSON().description.includes(message(language, "quizWrongAnswerCost", { cost: 4 })));
  }
  stage = "validation";
  const before = writes;
  for (const changes of [
    { guildId: "other" }, { channelId: "other" }, { user: { id: "player", bot: true } },
    { message: { id: "quiz", author: { id: "other" }, flags: { has: () => false } } },
    { message: { id: "quiz", author: { id: "bot" }, flags: { has: () => true } } }
  ]) {
    const request = interaction(changes); await handleQuizReportButton(request); assert.equal(request.result.modal, null);
    await handleQuizReportModal(interaction({ customId: "quiz:report:quiz", ...changes }));
  }
  for (const changes of [{ customId: "quiz:report:other" }, { isFromMessage: () => false }, { fields: { getTextInputValue: () => "short" } }]) {
    await handleQuizReportModal(interaction({ customId: "quiz:report:quiz", ...changes }));
  }
  assert.equal(writes, before, "Forged, cross-server, private-source and invalid submissions cannot save reports");
  assert.equal(await recordQuizReport(identity, "invalid", "x".repeat(1001)), "invalid");
  stage = "review-privacy";
  const fake = { ...[...reports.values()][0], reason: "Contact private" + "@example.test " + "sk-" + "synthetic".repeat(5),
    reporterUserId: "private-reporter" };
  let acknowledged = false;
  const database = { quizReport: {
    findMany: async request => { assert.equal(request.take, 101); assert.equal(request.where.reviewedAt, null); assert.equal(request.select.reporterUserId, undefined); return [fake]; },
    updateMany: async request => { assert.equal(request.where.reviewedAt, null); assert.ok(request.data.reviewedAt instanceof Date); const count = Number(!acknowledged); acknowledged = true; return { count }; }
  }, $transaction: async promises => Promise.all(promises) };
  const pending = await reviewQuizReports(database, { action: "pending" });
  assert.equal(pending.status, "ready"); assert.equal(pending.reports.length, 1);
  assert.doesNotMatch(JSON.stringify(pending), /private-reporter|private@example|sk-synthetic/);
  assert.ok(safeReportText("postgres" + "://test:test@localhost/test").includes("redacted"));
  assert.equal(safeReportText("password=" + "synthetic-private-value"), "[redacted credential]");
  const originalFindMany = database.quizReport.findMany;
  database.quizReport.findMany = async () => Array.from({ length: 101 }, () => fake);
  const fullBatch = await reviewQuizReports(database, { action: "pending" });
  assert.equal(fullBatch.reports.length, 100); assert.equal(fullBatch.hasMore, true);
  database.quizReport.findMany = originalFindMany;
  assert.deepEqual(await reviewQuizReports({}, { action: "pending" }), { status: "not-deployed" });
  assert.deepEqual(await reviewQuizReports(database, { action: "ack", reviews: [] }), { status: "invalid" });
  const input = { action: "ack", reviews: [{ id: fake.id, note: "Needs independent verification before any correction." }] };
  assert.equal((await reviewQuizReports(database, input)).reviewed, 1);
  assert.equal((await reviewQuizReports(database, input)).reviewed, 0);
  stage = "discord-delivery";
  let deliveryState = { reviewedAt: null, reviewNote: null };
  const deliveredBodies = [];
  const deliveryDatabase = { quizReport: {
    findMany: async () => [{ id: fake.id, reviewedAt: deliveryState.reviewedAt }],
    updateMany: async ({ data }) => { Object.assign(deliveryState, data); return { count: 1 }; }
  }, $transaction: async work => {
    const before = structuredClone(deliveryState);
    try { return await work(deliveryDatabase); } catch (error) { deliveryState = before; throw error; }
  } };
  const deliveryInput = { ...input, recipientId: "111111111111111111", messages: ["Reviewed quiz. Correction awaits your decision."] };
  const intro = message("pl", "quizReportReviewIntro", { count: 1 });
  const failingSend = async body => { deliveredBodies.push(body); if (deliveredBodies.length === 2) throw Error("Synthetic DM failure"); };
  await assert.rejects(deliverQuizReportReview(deliveryDatabase, deliveryInput, failingSend, intro), /Synthetic DM failure/);
  assert.equal(deliveryState.reviewedAt, null); assert.equal(deliveryState.reviewNote, null);
  const firstNonce = deliveredBodies[0].nonce;
  deliveredBodies.length = 0;
  const send = async body => { assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.equal(body.enforce_nonce, true); deliveredBodies.push(body); };
  const delivery = await deliverQuizReportReview(deliveryDatabase, deliveryInput, send, intro);
  assert.equal(delivery.status, "delivered"); assert.equal(delivery.reviewed, 1);
  assert.equal(deliveredBodies[0].nonce, firstNonce); assert.ok(firstNonce.length <= 25);
  assert.ok(deliveryState.reviewedAt instanceof Date);
  assert.equal((await deliverQuizReportReview(deliveryDatabase, deliveryInput, send, intro)).status, "already-delivered");
  assert.equal(deliveredBodies.length, 2, "A completed review cannot send another DM");
  assert.equal((await deliverQuizReportReview(deliveryDatabase, { ...deliveryInput, recipientId: "invalid" }, send, intro)).status, "invalid");
  console.log(JSON.stringify({ check: "quiz-reports", passed: true, privateForms: true, sourceValidation: true, duplicatesPrevented: true, closedQuizzes: true, reviewPrivacy: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "quiz-reports", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation", line: Number(error.stack?.match(/test-quiz-reports\.mjs:(\d+)/)?.[1] || 0) }));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
