import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";
import { deliverQuizReportReview, reviewQuizReports } from "./lib/quiz-report-review.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test", QUIZ_REPORT_RECIPIENT_ID: "111111111111111111" });
const { db } = await import("../dist/db.js");
const { recordQuizReport } = await import("../dist/services/quiz-reports.js");
const { processQuizReportBatch } = await import("../dist/services/quiz-report-scheduler.js");
const { reportAnalysisScopeKey } = await import("../dist/services/quiz-report-analysis.js");
const guildId = "reports-test-" + randomUUID();
const identity = { guildId, channelId: "test-channel", messageId: guildId + "-random" };
let stage = "create";
try {
  const source = await db.randomPoll.create({ data: { ...identity, language: "en", question: "Which number is even?",
    options: '["2","3"]', correctOption: 0, explanation: "Two is even.", difficulty: "hard", endedAt: new Date() } });
  const reason = "The explanation needs a source.";
  const results = await Promise.all(Array.from({ length: 3 }, () => recordQuizReport(identity, "reporter", reason)));
  assert.equal(results.filter(value => value === "saved").length, 1);
  assert.equal(results.filter(value => value === "existing").length, 2);
  assert.equal(await db.quizReport.count({ where: { guildId } }), 1);
  assert.equal(await recordQuizReport({ ...identity, guildId: "other-guild" }, "other", reason), "missing");
  assert.equal(await recordQuizReport(identity, "other", "short"), "invalid");
  assert.equal(await recordQuizReport(identity, "other", reason), "saved");
  const topicIdentity = { ...identity, messageId: guildId + "-topic" };
  await db.generatedPoll.create({ data: { ...topicIdentity, topicId: "synthetic-topic", question: source.question,
    options: source.options, correctOption: source.correctOption, explanation: source.explanation, difficulty: "easy" } });
  assert.equal(await recordQuizReport(topicIdentity, "reporter", reason), "saved");
  stage = "retention";
  await db.randomPoll.delete({ where: { messageId: identity.messageId } });
  const snapshot = await db.quizReport.findFirstOrThrow({ where: { guildId, messageId: identity.messageId } });
  assert.equal(snapshot.question, source.question); assert.equal(snapshot.explanation, source.explanation);
  assert.equal(snapshot.options, source.options); assert.equal(snapshot.difficulty, "hard");
  assert.equal(snapshot.reviewedAt, null);
  stage = "review";
  const pending = await reviewQuizReports(db, { action: "pending" });
  const item = pending.reports.find(report => report.id === snapshot.id);
  assert.ok(item); assert.equal(item.reporterUserId, undefined); assert.equal(item.guildId, undefined);
  const input = { action: "ack", reviews: [{ id: snapshot.id, note: "Reviewed synthetic fixture; no quiz correction authorized." }] };
  assert.equal((await reviewQuizReports(db, input)).reviewed, 1);
  assert.equal((await reviewQuizReports(db, input)).reviewed, 0);
  assert.ok(!(await reviewQuizReports(db, { action: "pending" })).reports.some(report => report.id === snapshot.id));
  assert.equal((await db.quizReport.findUniqueOrThrow({ where: { id: snapshot.id } })).reviewNote, input.reviews[0].note);
  stage = "private-delivery";
  const awaiting = await db.quizReport.findMany({ where: { guildId, reviewedAt: null } });
  const deliveryInput = { recipientId: "111111111111111111", reviews: awaiting.map(row => ({ id: row.id, note: "Synthetic review for private delivery; no correction authorized." })),
    messages: ["Synthetic private report summary."] };
  await assert.rejects(deliverQuizReportReview(db, deliveryInput, async () => { throw Error("Synthetic DM failure"); }, "Synthetic review header."));
  const afterFailure = await db.quizReport.findMany({ where: { guildId, reviewedAt: null } });
  assert.equal(afterFailure.length, awaiting.length); assert.ok(afterFailure.every(row => row.reviewNote === null));
  let sends = 0;
  const sent = await deliverQuizReportReview(db, deliveryInput, async body => { sends++; assert.equal(body.enforce_nonce, true);
    assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.equal(body.flags, undefined); }, "Synthetic review header.");
  assert.equal(sent.status, "delivered"); assert.equal(sent.reviewed, awaiting.length);
  assert.equal((await deliverQuizReportReview(db, deliveryInput, async () => { throw Error("Duplicate DM"); }, "Synthetic review header.")).status, "already-delivered");
  assert.equal(sends, 2); assert.equal(await db.quizReport.count({ where: { guildId, reviewedAt: null } }), 0);
  stage = "server-analysis-cache";
  assert.equal(await recordQuizReport(topicIdentity, "server-review", reason), "saved");
  const cached = await db.quizReport.findFirstOrThrow({ where: { guildId, reporterUserId: "server-review" } });
  let analyses = 0, dmBlocked = true;
  const analyze = async () => {
    analyses++;
    return { verdict: "uncertain", finding: "The synthetic report needs independent verification.",
      suggestion: "Check the evidence before changing the quiz.", sources: [] };
  };
  const client = { rest: { post: async (route, { body }) => {
    if (route === "/users/@me/channels") return { id: "direct" };
    assert.equal(route, "/channels/direct/messages");
    assert.equal(body.flags, undefined);
    if (dmBlocked) throw Error("Synthetic blocked DM");
    return { id: "private-message" };
  } } };
  const cutoff = new Date(Date.now() + 1000);
  await assert.rejects(processQuizReportBatch(client, cutoff, () => true, analyze), /Synthetic blocked DM/);
  const queued = await db.quizReport.findUniqueOrThrow({ where: { id: cached.id } });
  assert.equal(queued.reviewedAt, null); assert.ok(queued.analyzedAt); assert.ok(queued.analysis);
  dmBlocked = false;
  await processQuizReportBatch(client, cutoff, () => true, analyze);
  assert.equal(analyses, 1, "A persisted analysis survives delivery failure and is reused");
  assert.ok((await db.quizReport.findUniqueOrThrow({ where: { id: cached.id } })).reviewedAt);
  stage = "separate-issues-and-legacy-cache";
  const reasons = ["The reported word has a spelling error.", "The saved factual answer needs verification."];
  for (const [index, reason] of reasons.entries()) assert.equal(await recordQuizReport(topicIdentity, "scoped-" + index, reason), "saved");
  await db.quizReport.updateMany({ where: { guildId, reporterUserId: { in: ["scoped-0", "scoped-1"] } },
    data: { analysis: JSON.stringify({ verdict: "confirmed", finding: "Old whole-quiz analysis.", suggestion: "Old broad suggestion.", sources: [] }) } });
  let scopedAnalyses = 0;
  await processQuizReportBatch(client, cutoff, () => true, async reports => {
    scopedAnalyses++; assert.equal(reports.length, 1);
    return { kind: "unclear", verdict: "uncertain", finding: reports[0].reason,
      suggestion: "Only investigate the issue described in this report.", sources: [] };
  });
  assert.equal(scopedAnalyses, 2);
  const scoped = await db.quizReport.findMany({ where: { guildId, reporterUserId: { in: ["scoped-0", "scoped-1"] } } });
  for (const report of scoped) {
    assert.ok(report.reviewedAt); assert.ok(report.reviewNote.includes(report.reason));
    assert.equal(JSON.parse(report.analysis).scopeKey, reportAnalysisScopeKey(report));
    assert.ok(!report.reviewNote.includes(reasons.find(reason => reason !== report.reason)));
  }
  console.log(JSON.stringify({ check: "quiz-reports-postgres", passed: true, concurrentDuplicates: true, snapshotRetained: true, reviewAcknowledgement: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "quiz-reports-postgres", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation", line: Number(error.stack?.match(/test-quiz-reports-postgres\.mjs:(\d+)/)?.[1] || 0) }));
  process.exitCode = 1;
} finally {
  await db.quizReport.deleteMany({ where: { guildId } });
  await db.randomPoll.deleteMany({ where: { guildId } });
  await db.generatedPoll.deleteMany({ where: { guildId } });
  await db.$disconnect();
}
