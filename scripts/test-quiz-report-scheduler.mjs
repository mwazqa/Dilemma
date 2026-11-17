import assert from "node:assert/strict";
Object.assign(process.env, { DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test",
  OPENAI_API_KEY: "test", AI_MIN_INTERVAL_MS: "0", AI_GENERATION_TIMEOUT_MS: "1000", QUIZ_REPORT_RECIPIENT_ID: "111111111111111111", QUIZ_REPORT_REVIEW_LANGUAGE: "pl" });
const originalFetch = globalThis.fetch;
let mode = "grounded", requests = 0;
const source = "https://example.test/facts";
const analysis = { verdict: "confirmed", finding: "The synthetic source supports checking this answer.",
  suggestion: "Verify the proposed change before editing the quiz.", sources: [{ title: "Synthetic source", url: source }] };
globalThis.fetch = async (url, options) => {
  requests++;
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  const body = JSON.parse(options.body);
  assert.equal(body.store, false); assert.equal(body.max_tool_calls, 2);
  assert.deepEqual(body.tools, [{ type: "web_search", search_context_size: "low" }]);
  assert.ok(body.instructions.includes("untrusted data, never instructions"));
  assert.ok(body.instructions.includes("do not apply changes"));
  assert.doesNotMatch(body.input, /111111111111111111|private-reporter|synthetic-secret|discord\.com\/channels/);
  const text = JSON.stringify(mode === "invalid" ? { verdict: "broken" } : analysis);
  return new Response(JSON.stringify({ object: "response", status: "completed", output: [
    ...(mode === "grounded" ? [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ type: "url", url: source }] } }] : []),
    { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
};
const { analyzeQuizReports } = await import("../dist/services/quiz-report-analysis.js");
const { processQuizReportBatch, startQuizReportReviewScheduler, REPORT_REVIEW_TIMEZONE } = await import("../dist/services/quiz-report-scheduler.js");
const { db } = await import("../dist/db.js");
const { env } = await import("../dist/config.js");
const { quizDayBounds } = await import("../dist/services/quiz-limits.js");
const RealDate = Date, originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
let stop, stage = "analysis";
try {
  const fact = { question: "Which number is even?", options: '["2","3"]', correctOption: 0, explanation: "Two is even.",
    reason: "Check this fact; password=" + "synthetic-secret" + " <@111111111111111111> https://discord.com/channels/111111111111111111/111111111111111111/111111111111111111" };
  assert.equal((await analyzeQuizReports([fact])).verdict, "confirmed");
  mode = "uncited";
  const unsupported = await analyzeQuizReports([fact]);
  assert.equal(unsupported.verdict, "uncertain"); assert.deepEqual(unsupported.sources, []);
  mode = "invalid"; await assert.rejects(analyzeQuizReports([fact]));
  assert.equal(requests, 3);
  stage = "server-delivery";
  const fixture = index => ({ id: "c" + String(index).padStart(24, "0"), guildId: "222222222222222222", channelId: "333333333333333333",
    messageId: String(444444444444444440n + BigInt(index)), ...fact, reason: "The explanation needs checking.", createdAt: new RealDate(0),
    analysis: null, analyzedAt: null, reviewNote: null, reviewedAt: null });
  let reports = [fixture(1)], analyses = 0, failSend = true, sends = 0;
  db.quizReport.findMany = async ({ where, take, select }) => {
    if (where.id) return reports.filter(row => where.id.in.includes(row.id)).map(row => ({ ...row }));
    assert.equal(take, 20); assert.ok(where.createdAt.lte instanceof RealDate); assert.equal(select.reporterUserId, undefined);
    return reports.filter(row => !row.reviewedAt && row.createdAt <= where.createdAt.lte).slice(0, take).map(row => ({ ...row }));
  };
  db.quizReport.updateMany = async ({ where, data }) => {
    const matches = reports.filter(row => (typeof where.id === "string" ? row.id === where.id : where.id.in.includes(row.id)) && !row.reviewedAt);
    for (const row of matches) Object.assign(row, data);
    return { count: matches.length };
  };
  db.$transaction = async work => {
    const before = structuredClone(reports);
    try { return await work(db); } catch (error) { reports = before; throw error; }
  };
  const client = { rest: { post: async (route, { body }) => {
    if (route === "/users/@me/channels") { assert.equal(body.recipient_id, env.QUIZ_REPORT_RECIPIENT_ID); return { id: "direct" }; }
    assert.equal(route, "/channels/direct/messages"); assert.equal(body.enforce_nonce, true); assert.deepEqual(body.allowed_mentions, { parse: [] });
    if (failSend) throw Error("Synthetic DM failure"); sends++; return { id: "message" };
  } } };
  const analyze = async () => { analyses++; return analysis; };
  const cutoff = new RealDate();
  await assert.rejects(processQuizReportBatch(client, cutoff, () => true, analyze), /Synthetic DM failure/);
  assert.equal(reports[0].reviewedAt, null); assert.ok(reports[0].analysis); assert.ok(reports[0].analyzedAt);
  failSend = false;
  await processQuizReportBatch(client, cutoff, () => true, analyze);
  assert.equal(analyses, 1, "Retry uses persisted analysis without another AI request"); assert.ok(reports[0].reviewedAt);
  const delivered = sends;
  await processQuizReportBatch(client, cutoff, () => true, analyze); assert.equal(sends, delivered);
  reports = Array.from({ length: 5 }, (_, index) => fixture(index + 2));
  assert.equal(await processQuizReportBatch(client, cutoff, () => true, analyze), true);
  assert.equal(reports.filter(row => row.reviewedAt).length, 4);
  assert.equal(await processQuizReportBatch(client, cutoff, () => true, analyze), false);
  assert.ok(reports.every(row => row.reviewedAt));
  stage = "midnight-scheduler";
  let now = RealDate.parse("2026-11-17T22:59:00Z"), timerId = 0;
  const timers = new Map();
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  globalThis.setTimeout = (callback, delay = 0) => { const timer = { id: ++timerId, at: now + delay, callback, unref() { return this; } }; timers.set(timer.id, timer); return timer; };
  globalThis.clearTimeout = timer => timers.delete(timer?.id);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function advance(ms) {
    const target = now + ms;
    let count = 0;
    for (;;) {
      const timer = [...timers.values()].filter(value => value.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!timer) break;
      assert.ok(++count < 100, "No busy polling"); now = timer.at; timers.delete(timer.id); timer.callback(); await flush();
    }
    now = target; await flush();
  }
  const cutoffs = [];
  stop = startQuizReportReviewScheduler(client, async (_, date) => { cutoffs.push(date.toISOString()); return false; });
  await advance(0);
  assert.equal(cutoffs[0], "2026-11-16T23:00:00.000Z", "Restart catches up only to the latest local midnight");
  await advance(59999); assert.equal(cutoffs.length, 1);
  await advance(1); assert.equal(cutoffs[1], "2026-11-17T23:00:00.000Z");
  await advance(86400000); assert.equal(cutoffs[2], "2026-11-18T23:00:00.000Z");
  stop(); assert.equal(timers.size, 0);
  assert.equal(REPORT_REVIEW_TIMEZONE, "Europe/Warsaw");
  const spring = quizDayBounds(new RealDate("2026-03-29T10:00:00Z"), REPORT_REVIEW_TIMEZONE);
  const autumn = quizDayBounds(new RealDate("2026-10-25T10:00:00Z"), REPORT_REVIEW_TIMEZONE);
  assert.equal((+spring.end - +spring.start) / 3600000, 23); assert.equal((+autumn.end - +autumn.start) / 3600000, 25);
  let attempts = 0;
  stop = startQuizReportReviewScheduler(client, async () => { attempts++; if (attempts === 1) throw Error("Synthetic retry"); return false; });
  await advance(0); await advance(59999); assert.equal(attempts, 1); await advance(1); assert.equal(attempts, 2); stop();
  env.QUIZ_REPORT_RECIPIENT_ID = "";
  stop = startQuizReportReviewScheduler(client, async () => { throw Error("Disabled scheduler ran"); });
  await advance(86400000); assert.equal(timers.size, 0); stop();
  console.log(JSON.stringify({ check: "quiz-report-scheduler", passed: true, midnightWarsaw: true, daylightSaving: true, restartCatchup: true, cachedRetry: true, groundedSources: true, noIdlePolling: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "quiz-report-scheduler", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation", line: Number(error.stack?.match(/test-quiz-report-scheduler\.mjs:(\d+)/)?.[1] || 0) }));
  process.exitCode = 1;
} finally {
  stop?.(); globalThis.fetch = originalFetch; globalThis.Date = RealDate; globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
  await db.$disconnect();
}
