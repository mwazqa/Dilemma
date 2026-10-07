import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", QUIZ_TIMEZONE: "Europe/Warsaw",
  AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const { Prisma } = await import("@prisma/client");
const { db } = await import("../dist/db.js");
const { claimQuizRun, releaseQuizRun, runKey, quizDay, quizDayBounds, isTopicDue, validatePollDuration, DailyQuizLimitError } =
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
db.dailyQuizRun.findMany = async ({ where }) => [...runs.values()].filter(run =>
  run.guildId === where.guildId && run.scope === where.scope && run.day === where.day);
db.dailyQuizRun.create = async ({ data }) => {
  if (runs.has(key(data))) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  const run = { ...data, createdAt: new Date(), messageId: null };
  runs.set(key(data), run);
  return run;
};
db.dailyQuizRun.update = async ({ where, data }) => {
  const run = runs.get(key(where.guildId_scope_day_slot));
  assert.ok(run);
  Object.assign(run, data);
  return run;
};
db.dailyQuizRun.deleteMany = async ({ where }) => {
  const run = runs.get(key(where));
  if (run && run.messageId === null) { runs.delete(key(where)); return { count: 1 }; }
  return { count: 0 };
};
const matches = (row, where) => row.guildId === where.guildId &&
  (!where.topicId || row.topicId === where.topicId) && row.createdAt >= where.createdAt.gte &&
  row.createdAt < where.createdAt.lt && !where.messageId?.notIn.includes(row.messageId);
db.randomPoll.count = async ({ where }) => randomPolls.filter(row => matches(row, where)).length;
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
db.$transaction = async callback => callback(db);
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
for (const invalid of [0, 25, 1.5, NaN]) assert.throws(() => validatePollDuration(invalid));
reset();
const parallel = await Promise.allSettled(Array.from({ length: 10 }, () => claimQuizRun("guild")));
assert.equal(parallel.filter(result => result.status === "fulfilled").length, 3);
assert.ok(parallel.filter(result => result.status === "rejected").every(result => result.reason instanceof DailyQuizLimitError));
await claimQuizRun("other-guild");
await claimQuizRun("guild", "first-topic");
await claimQuizRun("guild", "second-topic");
await assert.rejects(claimQuizRun("guild", "first-topic"), DailyQuizLimitError);
await claimQuizRun("guild", "first-topic", new Date("2026-10-09T08:00:00Z"));
// Persisted rows, not process-local counters, enforce restart-safe quota.
await assert.rejects(claimQuizRun("guild"), DailyQuizLimitError);
reset();
const reservation = await claimQuizRun("guild");
await releaseQuizRun(reservation);
assert.equal((await claimQuizRun("guild")).slot, 1);
reset();
randomPolls.push(...[1, 2].map(n => ({ guildId: "guild", messageId: "legacy-" + n, createdAt: new Date() })));
const migrated = await claimQuizRun("guild");
assert.equal(migrated.slot, 3);
await db.dailyQuizRun.update({ where: runKey(migrated), data: { messageId: "new" } });
randomPolls.push({ guildId: "guild", messageId: "new", createdAt: new Date() });
await assert.rejects(claimQuizRun("guild"), DailyQuizLimitError);
reset();
const legacyTopic = makeTopic();
legacyTopic.lastGeneratedAt = new Date();
await assert.rejects(claimQuizRun("guild", legacyTopic.id), DailyQuizLimitError);
legacyTopic.lastGeneratedAt = null;
generatedPolls.push({ guildId: "guild", topicId: legacyTopic.id, messageId: "legacy", createdAt: new Date() });
await assert.rejects(claimQuizRun("guild", legacyTopic.id), DailyQuizLimitError);

let aiCalls = 0, sent = 0, failAi = false, failSend = false;
globalThis.fetch = async () => {
  aiCalls++;
  if (failAi) throw new Error("generation failure");
  const question = { language: "pl", topic: "Test", question: `Question ${aiCalls}?`, options: ["A", "B"],
    optionEmojis: ["", ""], topicEmoji: "", correctOption: 0, explanation: "Fact." };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(question) } }] }),
    { headers: { "content-type": "application/json" } });
};
const durations = [];
const { publishTopicQuestions, publishRandomQuestion } = await import("../dist/services/poll-publisher.js");
const { runDueTopics } = await import("../dist/scheduler.js");
const channel = { id: "channel", send: async payload => {
  if (failSend) throw new Error("uncertain send");
  sent++;
  durations.push(payload.poll.duration);
  return { id: "message-" + sent, channelId: "channel", poll: { allowMultiselect: false,
    expiresAt: new Date(now.getTime() + payload.poll.duration * 3_600_000),
    answers: new Map(payload.poll.answers.map((answer, i) => [i + 1, { id: i + 1, text: answer.text }])) } };
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
for (let i = 0; i < 3; i++) await publishRandomQuestion("guild", "pl", 2, channel, "easy", 4);
assert.equal(durations.at(-1), 4);
const beforeQuota = aiCalls;
await assert.rejects(publishRandomQuestion("guild", "pl", 2, channel), DailyQuizLimitError);
assert.equal(aiCalls, beforeQuota);
reset();
failAi = true;
await assert.rejects(publishRandomQuestion("guild", "pl", 2, channel));
assert.equal(runs.size, 0, "AI failures before send release quota");
failAi = false;
failSend = true;
await assert.rejects(publishRandomQuestion("guild", "pl", 2, channel));
assert.equal(runs.size, 1, "Uncertain sends keep their reservation");
failSend = false;
await publishRandomQuestion("guild", "pl", 2, channel);
await publishRandomQuestion("guild", "pl", 2, channel);
await assert.rejects(publishRandomQuestion("guild", "pl", 2, channel), DailyQuizLimitError);
globalThis.Date = RealDate;
await db.$disconnect();
console.log("PASS: daily quotas, concurrency, migration-day history, calendar/DST, schedule replacement, durations and failure recovery");
