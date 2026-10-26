import assert from "node:assert/strict";
import { quizAnswers, quizDuration } from "./fixtures/native-quiz.mjs";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", QUIZ_TIMEZONE: "Europe/Warsaw",
  OPENAI_API_KEY: "test", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const { Prisma } = await import("@prisma/client");
const { db } = await import("../dist/db.js");
db.quizChannel.findUnique = async ({ where }) => ({ channelId: where.guildId_channelId.channelId });
const { claimQuizRun, refreshRandomQuizRun, releaseQuizRun, runKey, quizDay, quizDayBounds, isTopicDue,
  validatePollDuration, DailyQuizLimitError, RandomQuizCooldownError, RANDOM_COOLDOWN_MS, RANDOM_DAILY_LIMIT } =
  await import("../dist/services/quiz-limits.js");
const RealDate = Date;
let now = new RealDate("2026-10-08T08:00:00Z");
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  static now() { return now.getTime(); }
};
const runs = new Map();
const topics = new Map();
const randomPolls = [];
const generatedPolls = [];
const key = data => JSON.stringify([data.guildId, data.scope, data.day, data.slot]);
db.dailyQuizRun.findMany = async ({ where, take }) => {
  const rows = [...runs.values()].filter(run => run.guildId === where.guildId &&
    (typeof where.scope === "string" ? run.scope === where.scope : where.scope.in.includes(run.scope)) &&
    (!where.day || run.day === where.day) && (!where.createdAt?.gt || run.createdAt > where.createdAt.gt) &&
    (!where.createdAt?.gte || run.createdAt >= where.createdAt.gte)).sort((a, b) => b.createdAt - a.createdAt);
  return (take === undefined ? rows : rows.slice(0, take)).map(row => ({ ...row }));
};
db.dailyQuizRun.findUnique = async ({ where }) => {
  const row = runs.get(key(where.guildId_scope_day_slot));
  return row ? { ...row } : null;
};
db.dailyQuizRun.updateMany = async ({ where, data }) => {
  const run = runs.get(key(where));
  if (!run || (where.createdAt instanceof RealDate ? +run.createdAt !== +where.createdAt :
    run.createdAt > where.createdAt.lte) || (where.messageId === null && run.messageId !== null)) return { count: 0 };
  Object.assign(run, data);
  return { count: 1 };
};
db.dailyQuizRun.create = async ({ data }) => {
  if (runs.has(key(data))) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  const run = { ...data, createdAt: data.createdAt ?? new Date(), messageId: null };
  runs.set(key(data), run);
  return { ...run };
};
db.dailyQuizRun.update = async ({ where, data }) => {
  const run = runs.get(key(where.guildId_scope_day_slot));
  assert.ok(run);
  Object.assign(run, data);
  return run;
};
db.dailyQuizRun.deleteMany = async ({ where }) => {
  const run = runs.get(key(where));
  if (run && run.messageId === null && +run.createdAt === +where.createdAt) { runs.delete(key(where)); return { count: 1 }; }
  return { count: 0 };
};
const matches = (row, where) => row.guildId === where.guildId &&
  (!where.topicId || row.topicId === where.topicId) && row.createdAt >= where.createdAt.gte &&
  row.createdAt < where.createdAt.lt && !where.messageId?.notIn.includes(row.messageId);
db.randomPoll.count = async ({ where }) => randomPolls.filter(row => matches(row, where)).length;
db.randomPoll.findFirst = async ({ where }) => randomPolls.filter(row => row.guildId === where.guildId &&
  row.createdAt > where.createdAt.gt).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
db.generatedPoll.count = async ({ where }) => generatedPolls.filter(row => matches(row, where)).length;
db.topic.findUnique = async ({ where }) => topics.get(where.id) ?? null;
db.topic.findMany = async () => [...topics.values()].filter(topic => topic.enabled);
db.topic.update = async ({ where, data }) => {
  const topic = topics.get(where.id);
  Object.assign(topic, { ...data, questionsGenerated: topic.questionsGenerated + (data.questionsGenerated?.increment ?? 0) });
  return topic;
};
db.guildSettings.findUnique = async () => ({ language: "pl" });
db.generatedPoll.findMany = db.randomPoll.findMany = async () => [];
db.generatedPoll.create = async ({ data }) => { generatedPolls.push({ ...data, createdAt: new Date() }); return data; };
db.randomPoll.create = async ({ data }) => { randomPolls.push({ ...data, createdAt: new Date() }); return data; };
db.quizSettlement.create = async ({ data }) => data;
let transactionTail = Promise.resolve();
db.$transaction = async callback => {
  const previous = transactionTail;
  let unlock;
  transactionTail = new Promise(resolve => { unlock = resolve; });
  await previous;
  const savedRuns = structuredClone(runs), savedRandom = structuredClone(randomPolls), savedGenerated = structuredClone(generatedPolls);
  try { return await callback(db); }
  catch (error) {
    runs.clear(); for (const [id, row] of savedRuns) runs.set(id, row);
    randomPolls.splice(0, randomPolls.length, ...savedRandom);
    generatedPolls.splice(0, generatedPolls.length, ...savedGenerated);
    throw error;
  } finally { unlock(); }
};
function reset() { runs.clear(); topics.clear(); randomPolls.length = generatedPolls.length = 0; }
function makeTopic(id = "topic", guildId = "guild") {
  const topic = { id, guildId, name: "Test", difficulty: "medium", pollDurationHours: 2, options: "", optionCount: 2,
    questionsGenerated: 0, lastGeneratedAt: null, generationTime: "18:00", intervalDays: 1, channelId: "channel", enabled: true };
  topics.set(id, topic);
  return topic;
}
assert.equal(quizDay(new Date("2026-10-08T21:59:59Z")), "2026-10-08");
assert.equal(quizDay(new Date("2026-10-08T22:00:00Z")), "2026-10-09");
for (const [date, hours] of [["2026-03-29T12:00:00Z", 23], ["2026-10-25T12:00:00Z", 25]]) {
  const bounds = quizDayBounds(new Date(date));
  assert.equal((bounds.end - bounds.start) / 3_600_000, hours);
}
assert.equal(validatePollDuration(1), 1);
assert.equal(validatePollDuration(24), 24);
assert.equal(RANDOM_COOLDOWN_MS, 6 * 3_600_000);
assert.equal(RANDOM_DAILY_LIMIT, 4);
for (const invalid of [0, 25, 1.5, NaN]) assert.throws(() => validatePollDuration(invalid));
reset();
const parallel = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun("guild")));
assert.equal(parallel.filter(result => result.status === "fulfilled").length, 1);
assert.ok(parallel.filter(result => result.status === "rejected").every(result => result.reason instanceof RandomQuizCooldownError));
await claimQuizRun("other-guild");
await claimQuizRun("guild", "first-topic");
await claimQuizRun("guild", "second-topic");
await assert.rejects(claimQuizRun("guild", "first-topic"), DailyQuizLimitError);
await claimQuizRun("guild", "first-topic", new Date("2026-10-09T08:00:00Z"));
await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError);
reset();
const reservation = await claimQuizRun("guild");
await releaseQuizRun(reservation);
assert.equal(runs.size, 0);
assert.equal((await claimQuizRun("guild")).slot, 1);
reset();
randomPolls.push(...[1, 2, 3, 4].map(n => ({ guildId: "guild", messageId: "legacy-" + n, createdAt: new Date() })));
await assert.rejects(claimQuizRun("guild"), error => error instanceof DailyQuizLimitError && error.kind === "random");
now = new Date(+now + RANDOM_COOLDOWN_MS);
await assert.rejects(claimQuizRun("guild"), DailyQuizLimitError);
now = new Date("2026-10-09T08:00:00Z");
const migrated = await claimQuizRun("guild");
assert.equal(migrated.dailyRun.day, quizDay(now));
reset();
const legacyRun = { guildId: "guild", scope: "random", day: quizDay(now), slot: 3, createdAt: now, messageId: null };
runs.set(key(legacyRun), legacyRun);
await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError);
now = new Date(+now + RANDOM_COOLDOWN_MS);
await claimQuizRun("guild");
await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError);
reset();
now = new Date("2026-10-09T00:00:00Z");
const legacyPending = { guildId: "guild", scope: "random", day: "cooldown", slot: 1, createdAt: now, messageId: null };
runs.set(key(legacyPending), legacyPending);
now = new Date(+now + RANDOM_COOLDOWN_MS);
await claimQuizRun("guild");
now = new Date(+now + RANDOM_COOLDOWN_MS);
assert.equal([...runs.values()].filter(run => run.scope === "random-daily" && run.day === quizDay(now)).length, 2,
  "An older uncertain send keeps its daily slot after the rolling cooldown row is reused");
reset();
now = new Date("2026-10-08T21:45:00Z");
const oldLease = await claimQuizRun("guild");
now = new Date(+now + RANDOM_COOLDOWN_MS - 1);
await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError, "Midnight does not reset cooldown");
now = new Date(+now + 1);
const expiredParallel = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun("guild")));
assert.equal(expiredParallel.filter(result => result.status === "fulfilled").length, 1, "Only one caller reclaims an expired row");
await releaseQuizRun(oldLease);
await assert.rejects(refreshRandomQuizRun(oldLease), RandomQuizCooldownError, "Old leases cannot refresh newer reservations");
await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError, "Old leases cannot release newer reservations");
for (const date of ["2026-03-29T00:30:00Z", "2026-10-25T00:30:00Z"]) {
  reset();
  now = new Date(date);
  await claimQuizRun("guild");
  now = new Date(+now + RANDOM_COOLDOWN_MS - 1);
  await assert.rejects(claimQuizRun("guild"), RandomQuizCooldownError);
  now = new Date(+now + 1);
  await claimQuizRun("guild");
}
reset();
now = new Date("2026-10-08T00:00:00Z");
await claimQuizRun("guild");
now = new Date(+now + RANDOM_COOLDOWN_MS);
const secondParallel = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun("guild")));
assert.equal(secondParallel.filter(result => result.status === "fulfilled").length, 1);
now = new Date(+now + RANDOM_COOLDOWN_MS);
await claimQuizRun("guild");
now = new Date(+now + RANDOM_COOLDOWN_MS);
await claimQuizRun("guild");
await assert.rejects(claimQuizRun("guild"), DailyQuizLimitError);
reset();
const createReservation = db.dailyQuizRun.create;
db.dailyQuizRun.create = async request => {
  if (request.data.scope === "random-daily") throw new Error("Injected daily write failure");
  return createReservation(request);
};
await assert.rejects(claimQuizRun("guild"), /Injected/);
assert.equal(runs.size, 0, "A failed daily claim rolls back its cooldown claim");
db.dailyQuizRun.create = createReservation;
const refreshReservation = await claimQuizRun("guild");
const beforeRefresh = structuredClone([...runs.entries()]);
const updateReservation = db.dailyQuizRun.updateMany;
db.dailyQuizRun.updateMany = async request => request.where.scope === "random-daily" ? { count: 0 } : updateReservation(request);
now = new Date(+now + 1000);
await assert.rejects(refreshRandomQuizRun(refreshReservation), /reservation changed/);
assert.deepEqual([...runs.entries()], beforeRefresh, "A failed refresh changes neither reservation");
db.dailyQuizRun.updateMany = updateReservation;
await releaseQuizRun(refreshReservation);
assert.equal(runs.size, 0);
reset();
now = new Date("2026-10-08T08:00:00Z");
const legacyTopic = makeTopic();
legacyTopic.lastGeneratedAt = new Date();
await assert.rejects(claimQuizRun("guild", legacyTopic.id), DailyQuizLimitError);
legacyTopic.lastGeneratedAt = null;
generatedPolls.push({ guildId: "guild", topicId: legacyTopic.id, messageId: "legacy", createdAt: new Date() });
await assert.rejects(claimQuizRun("guild", legacyTopic.id), DailyQuizLimitError);

let aiCalls = 0, sent = 0, failAi = false, failSend = false, wrongLanguage = false, sendDelay = 0, generationDelay = 0;
globalThis.fetch = async () => {
  aiCalls++;
  now = new Date(+now + generationDelay);
  if (failAi) throw new Error("generation failure");
  const question = { language: wrongLanguage ? "en" : "pl", topic: "Test", question: `Question ${aiCalls}?`, options: ["A", "B"],
    optionEmojis: ["", ""], topicEmoji: "", correctOption: 0, explanation: "Fact." };
  return new Response(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(question) }] }] }),
    { headers: { "content-type": "application/json" } });
};
const durations = [];
const { publishTopicQuestions, publishRandomQuestion } = await import("../dist/services/poll-publisher.js");
const { runDueTopics } = await import("../dist/scheduler.js");
const channel = { id: "channel", send: async payload => {
  if (failSend) throw new Error("uncertain send");
  now = new Date(+now + sendDelay);
  sent++;
  durations.push(quizDuration(payload));
  return { id: "message-" + sent, channelId: "channel", poll: { allowMultiselect: false,
    expiresAt: new Date(now.getTime() + quizDuration(payload) * 3_600_000),
    answers: new Map(quizAnswers(payload).map((answer, i) => [i + 1, { id: i + 1, text: answer.text }])) } };
}, isSendable: () => true };
reset();
const topic = makeTopic();
assert.equal(await publishTopicQuestions(topic, channel), 1);
assert.equal(sent, 1);
assert.equal(durations.at(-1), 2);
const callsBefore = aiCalls;
await assert.rejects(publishTopicQuestions(topic, channel), DailyQuizLimitError);
assert.equal(aiCalls, callsBefore, "A rejected run never calls AI");
now = new Date("2026-10-08T17:00:00Z");
assert.equal(isTopicDue(topic, now), false, "Early manual run replaces today's scheduled quiz");
topic.generationTime = "19:00";
assert.equal(isTopicDue(topic, now), false, "Changing the hour cannot reset today's run");
now = new Date("2026-10-09T17:00:00Z");
assert.equal(isTopicDue(topic, now), true, "Tomorrow's scheduled run is not delayed by a rolling 24h cooldown");
let channelFetches = 0;
await runDueTopics({ channels: { fetch: async () => { channelFetches++; return channel; } } });
assert.equal(sent, 2);
assert.equal(channelFetches, 1);
await runDueTopics({ channels: { fetch: async () => { channelFetches++; return channel; } } });
assert.equal(sent, 2);
assert.equal(channelFetches, 1);
const otherTopic = makeTopic("other-topic");
await publishTopicQuestions({ ...otherTopic, pollDurationHours: 1 }, channel);
assert.equal(durations.at(-1), 1);
assert.equal(otherTopic.pollDurationHours, 2, "A run override does not modify saved duration");
reset();
now = new Date("2026-10-24T22:00:00Z");
for (let i = 0; i < RANDOM_DAILY_LIMIT; i++) {
  await publishRandomQuestion("guild", 2, channel, "easy", 4);
  if (i < RANDOM_DAILY_LIMIT - 1) now = new Date(+now + RANDOM_COOLDOWN_MS);
}
assert.equal(randomPolls.length, RANDOM_DAILY_LIMIT);
assert.equal(durations.at(-1), 4);
const beforeQuota = aiCalls;
await assert.rejects(publishRandomQuestion("guild", 2, channel), DailyQuizLimitError);
now = new Date(+now + RANDOM_COOLDOWN_MS);
await assert.rejects(publishRandomQuestion("guild", 2, channel), DailyQuizLimitError, "Six hours do not reset the daily cap");
assert.equal(aiCalls, beforeQuota);
now = new Date("2026-10-26T00:00:00Z");
await publishRandomQuestion("guild", 2, channel);
reset();
now = new Date("2026-10-11T00:00:00Z");
failAi = true;
await assert.rejects(publishRandomQuestion("guild", 2, channel));
assert.equal(runs.size, 0, "AI failures before send release quota");
failAi = false;
failSend = true;
await assert.rejects(publishRandomQuestion("guild", 2, channel));
assert.equal(runs.size, 2, "Uncertain sends retain both daily quota and cooldown");
failSend = false;
await assert.rejects(publishRandomQuestion("guild", 2, channel), RandomQuizCooldownError);
now = new Date(+now + RANDOM_COOLDOWN_MS);
await publishRandomQuestion("guild", 2, channel);
await assert.rejects(publishRandomQuestion("guild", 2, channel), RandomQuizCooldownError);
reset();
sendDelay = 30_000;
await publishRandomQuestion("guild", 2, channel);
sendDelay = 0;
now = new Date(+now + RANDOM_COOLDOWN_MS - 1);
await assert.rejects(publishRandomQuestion("guild", 2, channel), RandomQuizCooldownError,
  "Cooldown starts after publication, not at the beginning of generation");
now = new Date(+now + 1);
await publishRandomQuestion("guild", 2, channel);
reset();
for (const phase of ["generation", "send"]) {
  reset();
  now = new Date(phase === "generation" ? "2026-10-11T21:59:00Z" : "2026-10-12T21:59:00Z");
  generationDelay = phase === "generation" ? 120_000 : 0;
  sendDelay = phase === "send" ? 120_000 : 0;
  await publishRandomQuestion("guild", 2, channel);
  generationDelay = sendDelay = 0;
  assert.equal(quizDay(now), phase === "generation" ? "2026-10-12" : "2026-10-13");
  now = new Date(+now + RANDOM_COOLDOWN_MS);
  await publishRandomQuestion("guild", 2, channel);
  now = new Date(+now + RANDOM_COOLDOWN_MS - 1);
  await assert.rejects(publishRandomQuestion("guild", 2, channel), RandomQuizCooldownError, `${phase} across midnight keeps the rolling cooldown`);
  now = new Date(+now + 1);
  await publishRandomQuestion("guild", 2, channel);
}
reset();
wrongLanguage = true;
const sentBeforeLanguageFailure = sent;
await assert.rejects(publishRandomQuestion("guild", 2, channel));
assert.equal(sent, sentBeforeLanguageFailure, "A wrong-language response must not reach Discord");
assert.equal(runs.size, 0, "Language validation failure releases the reservation");
globalThis.Date = RealDate;
await db.$disconnect();
console.log("PASS: four random quizzes per day, six-hour cooldown, atomic claims and rollback, stale leases, upgrade history, midnight/DST, topic quotas and failure recovery");
