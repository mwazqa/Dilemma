import assert from "node:assert/strict";

Object.assign(process.env, { DATABASE_URL: "file::memory:", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test",
  QUIZ_TIMEZONE: "Europe/Warsaw", OPENAI_API_KEY: "test",
  AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const realFetch = globalThis.fetch;
let fetchFixture = async () => { throw new Error("Unexpected network request in test"); };
globalThis.fetch = (...args) => fetchFixture(...args);
const { db } = await import("../dist/db.js");
const { DeadlineQueue, retryDelay } = await import("../dist/services/deadline-queue.js");
const { scheduleEvents, settlementDeadline } = await import("../dist/services/schedule-events.js");
const { nextTopicRunAt, quizDay } = await import("../dist/services/quiz-limits.js");
const { getGuildSettings, cacheGuildSettings, ensureGuildSettings, clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const { startScheduler } = await import("../dist/scheduler.js");
const { startScoreScheduler } = await import("../dist/services/scoring.js");
const { publishTopicQuestions, publishRandomQuestion } = await import("../dist/services/poll-publisher.js");
const { handleTopic } = await import("../dist/commands/topic.js");
const { handleSettings } = await import("../dist/commands/settings.js");
const { handleEndPollButton } = await import("../dist/commands/poll.js");
const { handleHelp } = await import("../dist/commands/help.js");
const { handlePing } = await import("../dist/commands/ping.js");
const RealDate = Date;
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let now = Date.parse("2026-10-18T08:00:00Z"), stage = "queue", timerId = 0;
const timers = new Map();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
globalThis.setTimeout = (callback, delay = 0) => {
  const timer = { id: ++timerId, at: now + delay, callback, unref() { return this; } };
  timers.set(timer.id, timer);
  return timer;
};
globalThis.clearTimeout = timer => timers.delete(timer?.id);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function advance(ms) {
  const target = now + ms;
  let iterations = 0;
  while (true) {
    const next = [...timers.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    assert.ok(++iterations < 10_000, "No immediate retry loop");
    now = next.at;
    timers.delete(next.id);
    next.callback();
    await flush();
  }
  now = target;
  await flush();
}
const stops = [];
try {
  let jobs = 0;
  const queue = new DeadlineQueue(async () => { jobs++; }, () => assert.fail("Queue failed"));
  stops.push(() => queue.stop());
  await advance(86_400_000);
  assert.equal(jobs, 0);
  assert.equal(timers.size, 0);
  queue.schedule("job", now + 60_000);
  await advance(59_999);
  assert.equal(jobs, 0);
  await advance(1);
  assert.equal(jobs, 1);
  assert.equal(timers.size, 0);
  queue.schedule("job", now + 1_000);
  queue.schedule("job", now + 2_000);
  await advance(1_000);
  assert.equal(jobs, 1);
  queue.cancel("job");
  await advance(1_000);
  assert.equal(jobs, 1);
  queue.schedule("long", now + 30 * 86_400_000);
  await advance(2_147_483_647);
  assert.equal(jobs, 1, "Timer overflow must not run work early");
  await advance(30 * 86_400_000 - 2_147_483_647);
  assert.equal(jobs, 2);
  assert.equal(timers.size, 0);
  assert.deepEqual([0, 1, 2, 10].map(attempt => retryDelay(attempt)), [60_000, 120_000, 240_000, 3_600_000]);

  let finish, stillCurrent;
  const pending = new DeadlineQueue(async (_, current) => {
    await new Promise(resolve => { finish = resolve; });
    stillCurrent = current();
  }, () => assert.fail("Queue failed"));
  stops.push(() => pending.stop());
  pending.schedule("pending", now);
  await advance(0);
  pending.cancel("pending");
  finish();
  await flush();
  assert.equal(stillCurrent, false, "In-flight work must see cancellation");
  assert.equal(timers.size, 0);
  let queueAttempts = 0, queueErrors = 0;
  const recovering = new DeadlineQueue(async () => {
    if (++queueAttempts === 1) throw new Error("Fixture job failure");
  }, () => { queueErrors++; });
  stops.push(() => recovering.stop());
  recovering.schedule("retry", now);
  await advance(0);
  assert.deepEqual([queueAttempts, queueErrors], [1, 1]);
  await advance(59_999);
  assert.equal(queueAttempts, 1);
  await advance(1);
  assert.equal(queueAttempts, 2, "Unexpected job failures cannot silently lose known work");

  stage = "calendar";
  const calendar = { enabled: true, channelId: "channel", generationTime: "18:30", lastGeneratedAt: null, intervalDays: 1 };
  assert.equal(nextTopicRunAt(calendar, new Date("2026-10-18T08:00:00Z")), Date.parse("2026-10-18T16:30:00Z"));
  assert.equal(nextTopicRunAt(calendar, new Date("2026-10-18T17:00:00Z")), Date.parse("2026-10-18T17:00:00Z"), "Catch up after downtime");
  assert.equal(nextTopicRunAt({ ...calendar, lastGeneratedAt: new Date("2026-10-18T08:00:00Z") },
    new Date("2026-10-18T09:00:00Z")), Date.parse("2026-10-19T16:30:00Z"), "An early run replaces today's slot");
  assert.equal(nextTopicRunAt({ ...calendar, intervalDays: 7, lastGeneratedAt: new Date("2026-10-18T08:00:00Z") },
    new Date("2026-10-18T09:00:00Z")), Date.parse("2026-10-25T17:30:00Z"), "Calendar days across DST");
  assert.equal(nextTopicRunAt({ ...calendar, generationTime: "02:30" }, new Date("2026-03-29T00:00:00Z")), Date.parse("2026-03-29T01:00:00Z"), "Missing DST hour uses the first later local minute");
  assert.equal(nextTopicRunAt({ ...calendar, generationTime: "02:30" }, new Date("2026-10-25T00:00:00Z")), Date.parse("2026-10-25T00:30:00Z"), "Repeated DST hour uses the first occurrence");
  assert.equal(nextTopicRunAt({ ...calendar, enabled: false }), null);
  assert.equal(nextTopicRunAt({ ...calendar, channelId: null }), null);
  assert.equal(nextTopicRunAt({ ...calendar, generationTime: null }), null);

  stage = "settings";
  let settingReads = 0, settingWrites = 0;
  let settings = { guildId: "guild", language: "pl", defaultIntervalDays: 1, defaultGenerationTime: null,
    defaultPollDurationHours: 2, defaultDifficulty: "easy" };
  db.guildSettings.findUnique = async () => { settingReads++; return settings ? { ...settings } : null; };
  db.guildSettings.findMany = async () => settings ? [{ guildId: settings.guildId, timezone: settings.timezone ?? null }] : [];
  db.guildSettings.upsert = async ({ create, update }) => {
    settingWrites++;
    return settings = { ...(settings ?? create), ...update };
  };
  clearGuildSettingsCache();
  await Promise.all(Array.from({ length: 10 }, () => getGuildSettings("guild")));
  assert.equal(settingReads, 1, "Concurrent settings reads share one query");
  assert.equal((await ensureGuildSettings("guild")).language, "pl");
  assert.equal(settingWrites, 0, "Existing settings do not need an upsert");
  cacheGuildSettings({ ...settings, language: "de" });
  assert.equal((await getGuildSettings("guild")).language, "de");
  let releaseRead;
  clearGuildSettingsCache();
  const readSettings = db.guildSettings.findUnique;
  db.guildSettings.findUnique = () => new Promise(resolve => { releaseRead = resolve; });
  const oldRead = getGuildSettings("guild");
  cacheGuildSettings({ ...settings, language: "ja" });
  releaseRead({ ...settings, language: "pl" });
  await oldRead;
  assert.equal((await getGuildSettings("guild")).language, "ja", "A slow read cannot overwrite a newer saved language");
  db.guildSettings.findUnique = readSettings;
  clearGuildSettingsCache();
  settings = null;
  await getGuildSettings("missing");
  const beforeMissing = settingReads;
  await getGuildSettings("missing");
  assert.equal(settingReads, beforeMissing, "Cache missing settings too");
  await advance(3_600_001);
  assert.equal(settingReads, beforeMissing, "Expiry itself performs no SQL");
  await getGuildSettings("missing");
  assert.equal(settingReads, beforeMissing + 1);
  clearGuildSettingsCache();
  db.guildSettings.findUnique = async () => { throw new Error("Fixture database outage"); };
  await assert.rejects(getGuildSettings("missing"));
  db.guildSettings.findUnique = readSettings;
  assert.equal(await getGuildSettings("missing"), null, "A failed lookup must not poison the cache");
  settings = { guildId: "guild", language: "pl", defaultIntervalDays: 1, defaultGenerationTime: null,
    defaultPollDurationHours: 2, defaultDifficulty: "easy" };
  clearGuildSettingsCache();

  stage = "fixtures";
  let topicLoads = 0, topicReads = 0, settlementLoads = 0, settlementReads = 0, aiCalls = 0, sent = 0, patches = 0, finalized = true;
  const topics = new Map(), quizzes = new Map(), runs = new Map(), polls = new Map();
  db.topic.findMany = async () => { topicLoads++; return [...topics.values()].filter(topic => topic.enabled && topic.generationTime && topic.channelId).map(topic => ({ ...topic })); };
  db.topic.findUnique = async ({ where }) => {
    topicReads++;
    const topic = where.id ? topics.get(where.id) : [...topics.values()].find(topic => topic.name === where.guildId_name.name);
    return topic ? { ...topic } : null;
  };
  db.topic.update = async ({ where, data }) => {
    const topic = topics.get(where.id);
    Object.assign(topic, { ...data, questionsGenerated: topic.questionsGenerated + (data.questionsGenerated?.increment ?? 0) });
    return { ...topic };
  };
  db.topic.create = async ({ data }) => {
    const created = { id: "created", enabled: true, questionsGenerated: 0, lastGeneratedAt: null, ...data };
    topics.set(created.id, created);
    return { ...created };
  };
  db.topic.delete = async ({ where }) => { const topic = topics.get(where.id); topics.delete(where.id); return topic; };
  db.quizSettlement.findMany = async () => { settlementLoads++; return [...quizzes.values()].filter(quiz => !quiz.scoredAt).map(quiz => ({ ...quiz })); };
  db.quizSettlement.findUnique = async ({ where }) => { settlementReads++; const quiz = quizzes.get(where.messageId); return quiz ? { ...quiz } : null; };
  db.quizSettlement.create = async ({ data }) => {
    const quiz = { nextCheckAt: new Date(), closedAt: null, scoredAt: null, ...data };
    quizzes.set(quiz.messageId, quiz);
    return quiz;
  };
  db.quizSettlement.updateMany = async ({ where, data }) => {
    const quiz = quizzes.get(where.messageId);
    if (!quiz || quiz.scoredAt || (where.guildId && quiz.guildId !== where.guildId)) return { count: 0 };
    Object.assign(quiz, data);
    return { count: 1 };
  };
  db.dailyQuizRun.findMany = async () => [];
  db.dailyQuizRun.create = async ({ data }) => { const run = { ...data, createdAt: new Date(), messageId: null }; runs.set(data.scope, run); return run; };
  db.dailyQuizRun.update = async ({ where, data }) => Object.assign(runs.get(where.guildId_scope_day_slot.scope), data);
  db.dailyQuizRun.deleteMany = async () => ({ count: 1 });
  db.dailyQuizRun.updateMany = async () => ({ count: 1 });
  db.generatedPoll.count = async () => 0;
  db.generatedPoll.findMany = async () => [];
  db.generatedPoll.findUnique = async ({ where }) => polls.get(where.messageId) ?? null;
  db.generatedPoll.updateMany = async ({ where, data }) => { const poll = polls.get(where.messageId); if (poll.endedAt) return { count: 0 }; Object.assign(poll, data); return { count: 1 }; };
  db.generatedPoll.create = async ({ data }) => { polls.set(data.messageId, { ...data, endedAt: null }); return data; };
  db.randomPoll.findFirst = async () => null;
  db.randomPoll.count = async () => 0;
  db.randomPoll.findMany = async () => [];
  db.randomPoll.create = async ({ data }) => data;
  db.$transaction = async work => work(db);
  fetchFixture = async () => {
    aiCalls++;
    const question = { language: settings.language, topic: "Test", question: `Question ${aiCalls}?`, options: ["A", "B"],
      optionEmojis: ["", ""], topicEmoji: "", correctOption: 0, explanation: "Fact." };
    return new Response(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(question) }] }] }), { headers: { "content-type": "application/json" } });
  };
  const channel = { id: "channel", isSendable: () => true, isTextBased: () => true,
    messages: { fetch: async id => ({ id, author: { id: "bot" }, poll: {
      expiresTimestamp: +quizzes.get(id).expiresAt,
      end: async () => { quizzes.get(id).expiresAt = new Date(now); }
    } }) },
    send: async payload => {
      if (!payload.poll) return;
      const id = `poll-${++sent}`;
      return { id, channelId: "channel", poll: { allowMultiselect: false,
        expiresAt: new Date(now + payload.poll.duration * 3_600_000),
        answers: new Map(payload.poll.answers.map((answer, i) => [i + 1, { id: i + 1, text: answer.text }])) } };
    } };
  const client = { user: { id: "bot" }, ws: { ping: 1 }, channels: { fetch: async () => channel }, rest: {
    patch: async () => { patches++; },
    get: async route => {
      if (route.includes("/answers/")) return { users: [] };
      const id = route.split("/").at(-1), quiz = quizzes.get(id);
      return { id, channel_id: "channel", author: { id: "bot" }, poll: { allow_multiselect: false,
        expiry: quiz.expiresAt.toISOString(), answers: [{ answer_id: 1 }, { answer_id: 2 }],
        results: { is_finalized: finalized, answer_counts: [] } } };
    }
  } };
  function makeTopic(id = "topic") {
    const topic = { id, guildId: "guild", name: id, enabled: true, channelId: "channel", generationTime: "12:00",
      lastGeneratedAt: null, intervalDays: 1, pollDurationHours: 2, questionsGenerated: 0, options: "", optionCount: 2, difficulty: "easy" };
    topics.set(id, topic);
    return topic;
  }
  function interaction(sub, values = {}) {
    return { guildId: "guild", locale: "en", client, channel, channelId: "channel", message: { id: values.messageId }, customId: "quiz:end",
      memberPermissions: { has: () => true }, options: { getSubcommand: () => sub, getString: key => values[key] ?? null, getInteger: key => values[key] ?? null },
      deferReply: async () => {}, editReply: async () => {} };
  }

  stage = "idle";
  now = Date.parse("2026-10-18T08:00:00Z");
  let stopTopic = startScheduler(client), stopScore = startScoreScheduler(client);
  await advance(0);
  assert.deepEqual([topicLoads, settlementLoads], [1, 1]);
  await advance(2 * 86_400_000);
  assert.deepEqual([topicLoads, settlementLoads, topicReads, settlementReads], [1, 1, 0, 0], "No SQL during 48 idle hours");
  assert.equal(timers.size, 0);
  stopTopic(); stopScore();

  stage = "deadline-publication";
  now = Date.parse("2026-10-18T08:00:00Z");
  const topic = makeTopic();
  stopTopic = startScheduler(client); stopScore = startScoreScheduler(client);
  stops.push(() => stopTopic(), () => stopScore());
  await advance(0);
  const beforeDue = topicReads;
  await advance(2 * 3_600_000 - 1);
  assert.equal(topicReads, beforeDue);
  assert.equal(aiCalls, 0);
  await advance(1);
  assert.equal(sent, 1);
  assert.equal(aiCalls, 1);
  assert.ok(quizzes.has("poll-1"), "Publication registers scoring only after commit");
  const beforeExpiry = settlementReads;
  await advance(2 * 3_600_000 - 1);
  assert.equal(settlementReads, beforeExpiry);
  await advance(1);
  assert.ok(quizzes.get("poll-1").scoredAt);
  assert.equal(patches, 1);

  stage = "command-events";
  await handleTopic(interaction("disable", { name: topic.name }));
  const beforeDisabled = topicReads;
  await advance(86_400_000);
  assert.equal(topicReads, beforeDisabled, "Disabling cancels the next run");
  assert.equal(sent, 1);
  await handleTopic(interaction("configure", { name: topic.name, generation_time: "16:00" }));
  assert.equal(topic.enabled, false, "Configuring a disabled topic must not enable it");
  await handleTopic(interaction("enable", { name: topic.name }));
  await advance(2 * 3_600_000);
  assert.equal(sent, 2, "Changing a schedule immediately replaces its timer");
  await handleEndPollButton(interaction("end", { messageId: "poll-2" }));
  await advance(0);
  assert.ok(quizzes.get("poll-2").scoredAt, "Manual close does not wait for original expiry");
  const afterManual = settlementReads;
  await advance(2 * 3_600_000);
  assert.equal(settlementReads, afterManual, "Old expiry timer is cancelled after early settlement");

  stage = "manual-run";
  now = Date.parse("2026-10-20T08:00:00Z");
  await publishTopicQuestions({ ...topic }, channel);
  const sentAfterEarly = sent;
  await advance(7 * 3_600_000);
  assert.equal(sent, sentAfterEarly, "An early manual run moves the next scheduled run to tomorrow");
  await handleTopic(interaction("delete", { name: topic.name }));
  const afterDelete = topicReads;
  await advance(86_400_000);
  assert.equal(topicReads, afterDelete);

  stage = "settings-commands";
  await handleSettings(interaction("language", { value: "de" }));
  const readsAfterLanguage = settingReads;
  assert.equal((await getGuildSettings("guild")).language, "de");
  await handleHelp(interaction("help"));
  await handlePing(interaction("ping"));
  assert.equal(settingReads, readsAfterLanguage, "Help/ping reuse the saved language without SQL");
  await handleSettings(interaction("timezone", { value: "Europe/Warsaw" }));
  assert.equal((await getGuildSettings("guild")).timezone, "Europe/Warsaw");
  await handleTopic(interaction("create", { name: "new", option_count: 2, generation_time: "18:30", difficulty: "hard" }));
  assert.equal(topics.get("created").generationTime, "18:30");
  assert.equal(topics.get("created").difficulty, "hard");
  await handleTopic(interaction("delete", { name: "new" }));
  stopTopic(); stopScore();

  stage = "random-deadline";
  stopScore = startScoreScheduler(client);
  await advance(0);
  await publishRandomQuestion("guild", 2, channel, "easy", 1);
  const randomId = `poll-${sent}`, beforeRandom = settlementReads;
  await advance(3_600_000 - 1);
  assert.equal(settlementReads, beforeRandom);
  await advance(1);
  assert.ok(quizzes.get(randomId).scoredAt, "Random publication also registers its expiry timer");
  stopScore();

  stage = "restart-backlog";
  topics.clear(); quizzes.clear();
  for (let i = 0; i < 30; i++) quizzes.set(`backlog-${i}`, { messageId: `backlog-${i}`, guildId: "guild", channelId: "channel",
    answerIds: "1,2", correctAnswerId: 1, difficulty: "easy", expiresAt: new Date(now - 60_000), closedAt: null, scoredAt: null, nextCheckAt: new Date(now - 60_000) });
  const beforeBacklog = settlementReads;
  stopScore = startScoreScheduler(client);
  await advance(0);
  assert.equal(settlementReads - beforeBacklog, 30, "Recover more than one old 25-row batch without polling");
  assert.ok([...quizzes.values()].every(quiz => quiz.scoredAt));
  const afterBacklog = settlementReads;
  await advance(86_400_000);
  assert.equal(settlementReads, afterBacklog);
  stopScore();

  stage = "pending-backoff";
  quizzes.clear();
  quizzes.set("pending", { messageId: "pending", guildId: "guild", channelId: "channel", answerIds: "1,2", correctAnswerId: 1,
    difficulty: "easy", expiresAt: new Date(now - 60_000), closedAt: null, scoredAt: null, nextCheckAt: new Date(now - 60_000) });
  finalized = false;
  stopScore = startScoreScheduler(client);
  const beforePending = settlementReads;
  await advance(0);
  assert.equal(settlementReads, beforePending + 1);
  await advance(60_000);
  assert.equal(settlementReads, beforePending + 2);
  await advance(60_000);
  assert.equal(settlementReads, beforePending + 2, "Second pending retry waits two minutes");
  finalized = true;
  await advance(60_000);
  assert.ok(quizzes.get("pending").scoredAt);
  stopScore();

  stage = "startup-race";
  topics.clear();
  const stale = makeTopic("stale");
  let releaseLoad;
  const loadTopics = db.topic.findMany;
  db.topic.findMany = () => new Promise(resolve => { releaseLoad = resolve; });
  stopTopic = startScheduler(client);
  await advance(0);
  await handleTopic(interaction("disable", { name: stale.name }));
  const beforeStale = topicReads;
  releaseLoad([{ ...stale, enabled: true }]);
  await flush();
  await advance(86_400_000);
  assert.equal(topicReads, beforeStale, "Startup snapshot cannot restore a cancelled timer");
  stopTopic();
  db.topic.findMany = loadTopics;

  stage = "startup-retry";
  topics.clear(); quizzes.clear();
  let loadAttempts = 0;
  db.topic.findMany = async () => {
    loadAttempts++;
    if (loadAttempts < 3) throw new Error("Fixture startup outage");
    return [];
  };
  stopTopic = startScheduler(client);
  await advance(0);
  assert.equal(loadAttempts, 1);
  await advance(300_000 - 1);
  assert.equal(loadAttempts, 1);
  await advance(1);
  assert.equal(loadAttempts, 2);
  await advance(600_000 - 1);
  assert.equal(loadAttempts, 2);
  await advance(1);
  assert.equal(loadAttempts, 3);
  await advance(86_400_000);
  assert.equal(loadAttempts, 3, "Recovered empty startup does not keep checking the database");
  stopTopic();
  db.topic.findMany = loadTopics;
  stage = "dated-topic-deadlines";
  topics.clear(); quizzes.clear();
  const dated = makeTopic("dated");
  dated.startDate = quizDay(new Date(now + 2 * 86_400_000));
  dated.intervalDays = 7;
  const firstDue = nextTopicRunAt(dated);
  const beforeDated = sent;
  stopTopic = startScheduler(client);
  await advance(0);
  const beforeDatedReads = topicReads;
  await advance(firstDue - now - 1);
  assert.equal(topicReads, beforeDatedReads, "A future start date needs no periodic SQL");
  assert.equal(sent, beforeDated);
  await advance(1);
  assert.equal(sent, beforeDated + 1);
  const afterFirstReads = topicReads;
  await advance(6 * 86_400_000);
  assert.equal(topicReads, afterFirstReads, "Fixed weekly schedules remain idle between deadlines");
  stopTopic();
  await advance(3 * 86_400_000);
  stopTopic = startScheduler(client);
  await advance(0);
  assert.equal(sent, beforeDated + 2, "Restart catches up one overdue fixed-date slot");
  assert.equal(nextTopicRunAt(dated), firstDue + 14 * 86_400_000, "Catch-up cannot move the next anchored date");
  stopTopic();
  assert.equal(scheduleEvents.listenerCount("topicChanged"), 0);
  assert.equal(scheduleEvents.listenerCount("settlementChanged"), 0);
  assert.equal(settlementDeadline({ scoredAt: new Date(), expiresAt: new Date(now), nextCheckAt: new Date(now), closedAt: null }), null);
  console.log("PASS: zero SQL in 48 idle hours, exact deadlines, restart backlog, DST, command invalidation, early close/run, settings cache and retry backoff");
} catch (error) {
  console.error(`FAIL: idle database stage=${stage}; category=${error instanceof assert.AssertionError ? "assertion" : "test-error"}`);
  if (typeof error.actual === "number" && typeof error.expected === "number") console.error(`Counts: actual=${error.actual}; expected=${error.expected}`);
  const line = error.stack?.match(/test-idle-database\.mjs:(\d+)/)?.[1];
  if (line) console.error(`Test line: ${line}`);
  process.exitCode = 1;
} finally {
  for (const stop of stops) stop();
  globalThis.Date = RealDate;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  globalThis.fetch = realFetch;
  clearGuildSettingsCache();
  await db.$disconnect();
}
