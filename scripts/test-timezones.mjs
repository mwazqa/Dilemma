import assert from "node:assert/strict";
import { quizGuild } from "./fixtures/quiz-channel.mjs";
import { spawnSync } from "node:child_process";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test", QUIZ_TIMEZONE: "Europe/Warsaw" });
globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
const { db } = await import("../dist/db.js");
const { guildTimezone, parseTimezone, timezoneSuggestions } = await import("../dist/services/timezone.js");
const { quizDay, quizDayBounds, nextTopicRunAt, isTopicDue, claimQuizRun, refreshRandomQuizRun, RANDOM_COOLDOWN_MS, DailyQuizLimitError, RandomQuizCooldownError } = await import("../dist/services/quiz-limits.js");
const { routeAutocomplete, dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { startScheduler } = await import("../dist/scheduler.js");
const { scheduleEvents } = await import("../dist/services/schedule-events.js");
const { cacheGuildSettings } = await import("../dist/services/guild-settings.js");
const { handleTopic } = await import("../dist/commands/topic.js");
const RealDate = Date;
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const timers = new Map();
let now = Date.parse("2026-10-22T00:30:00Z"), timerId = 0, reads = 0;
const settings = new Map([
  ["tokyo", { guildId: "tokyo", language: "pl", timezone: "Asia/Tokyo" }],
  ["ny", { guildId: "ny", language: "pl", timezone: "America/New_York" }]
]);
db.guildSettings.findUnique = async ({ where }) => { reads++; return settings.get(where.guildId) ?? null; };
db.guildSettings.findMany = async ({ where }) => { reads++; return [...settings.values()].filter(s => where.guildId.in.includes(s.guildId)); };
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
globalThis.setTimeout = (callback, delay = 0) => {
  const timer = { id: ++timerId, at: now + delay, callback, unref() { return this; } };
  timers.set(timer.id, timer); return timer;
};
globalThis.clearTimeout = timer => timers.delete(timer?.id);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function bootstrap() {
  const timer = [...timers.values()].find(t => t.at <= now);
  assert.ok(timer); timers.delete(timer.id); timer.callback(); await flush();
}
let stop;
try {
  assert.equal(guildTimezone(), "Europe/Warsaw");
  assert.equal(guildTimezone({ timezone: "Asia/Tokyo" }), "Asia/Tokyo");
  assert.equal(guildTimezone({ timezone: "Invalid/Zone" }), "Europe/Warsaw");
  assert.equal(parseTimezone(" europe/london "), "Europe/London");
  assert.equal(parseTimezone("UTC"), "UTC");
  for (const value of ["Invalid/Zone", "PL", "CET", "+02:00", "", "America/New_York\nUTC"]) assert.equal(parseTimezone(value), null);
  assert.ok(timezoneSuggestions("new york").some(c => c.value === "America/New_York"));
  assert.equal(timezoneSuggestions("").length, 25);
  assert.equal(quizDay(new Date(), "Asia/Tokyo"), "2026-10-22");
  assert.equal(quizDay(new Date(), "America/New_York"), "2026-10-21");
  assert.equal(quizDayBounds(new Date(), "Asia/Tokyo").start.toISOString(), "2026-10-21T15:00:00.000Z");
  assert.equal(quizDayBounds(new Date(), "America/New_York").end.toISOString(), "2026-10-22T04:00:00.000Z");
  for (const [day, hours] of [["2026-03-08T12:00:00Z", 23], ["2026-11-01T12:00:00Z", 25]]) {
    const bounds = quizDayBounds(new Date(day), "America/New_York");
    assert.equal((+bounds.end - +bounds.start) / 3600000, hours);
  }
  const topic = { id: "topic", guildId: "ny", enabled: true, channelId: "channel", generationTime: "18:30", startDate: "2026-10-22", intervalDays: 1, lastGeneratedAt: null };
  assert.equal(nextTopicRunAt(topic, new Date(), "Asia/Tokyo"), Date.parse("2026-10-22T09:30:00Z"));
  assert.equal(nextTopicRunAt(topic, new Date(), "America/New_York"), Date.parse("2026-10-22T22:30:00Z"));
  assert.equal(isTopicDue(topic, new Date("2026-10-22T10:00:00Z"), false, "Asia/Tokyo"), true);
  assert.equal(isTopicDue(topic, new Date("2026-10-22T10:00:00Z"), false, "America/New_York"), false);
  assert.equal(nextTopicRunAt({ ...topic, startDate: "2026-03-08", generationTime: "02:30" }, new Date("2026-03-08T00:00:00Z"), "America/New_York"), Date.parse("2026-03-08T07:00:00Z"));
  assert.equal(nextTopicRunAt({ ...topic, startDate: "2026-11-01", generationTime: "01:30" }, new Date("2026-11-01T00:00:00Z"), "America/New_York"), Date.parse("2026-11-01T05:30:00Z"));
  assert.equal(RANDOM_COOLDOWN_MS, 6 * 3600000);
  const fallbackEnv = { ...process.env }; delete fallbackEnv.QUIZ_TIMEZONE;
  const fallback = spawnSync(process.execPath, ["--input-type=module", "-e", "import{env}from'./dist/config.js';process.stdout.write(env.QUIZ_TIMEZONE)"], { encoding: "utf8", env: { ...fallbackEnv, DOTENV_CONFIG_PATH: "fixture-does-not-exist" } });
  assert.equal(fallback.status, 0); assert.equal(fallback.stdout, "Europe/Warsaw");
  const menu = dilemmaCommand.toJSON();
  assert.equal(menu.options.some(o => o.name === "defaults"), false);
  const timezone = menu.options.find(o => o.name === "timezone");
  assert.equal(timezone.options[0].autocomplete, true);
  assert.equal(!!timezone.options[0].required, false);
  for (const allowed of [true, false]) {
    await routeAutocomplete({ commandName: "dilemma", guildId: "ny", memberPermissions: { has: () => allowed }, options: { getSubcommandGroup: () => null, getSubcommand: () => "timezone", getFocused: () => "tokyo" }, respond: async choices => assert.equal(choices.some(c => c.value === "Asia/Tokyo"), allowed) });
  }
  const created = [];
  db.topic.findUnique = async () => null;
  db.topic.count = async ({ where }) => created.filter(topic => topic.guildId === where.guildId).length;
  db.$transaction = async work => work(db);
  db.topic.create = async ({ data }) => { created.push(data); return { ...topic, ...data }; };
  const ny = { ...settings.get("ny"), defaultDifficulty: "medium", defaultIntervalDays: 1, defaultPollDurationHours: 24 };
  cacheGuildSettings(ny);
  const request = { guildId: "ny", channelId: "channel", locale: "pl", memberPermissions: { has: () => true }, options: { getSubcommand: () => "create", getInteger: () => null, getString: key => ({ name: "Local date", start_date: "2026-10-21", generation_time: "18:30" })[key] ?? null }, deferReply: async () => {}, editReply: async payload => assert.ok(payload.content.includes("America/New_York")) };
  request.guild = quizGuild("ny");
  request.options.getChannel = () => null;
  request.options.getRole = () => null;
  request.options.getBoolean = () => null;
  await handleTopic(request);
  assert.equal(created[0].startDate, "2026-10-21", "Date validation uses the guild's current day, not Warsaw's");
  const reservations = [];
  const bounds = [];
  db.$transaction = async work => work(db);
  db.randomPoll.findFirst = async () => null;
  db.randomPoll.count = async ({ where }) => { bounds.push(where.createdAt); return 0; };
  db.dailyQuizRun.findMany = async () => [];
  db.dailyQuizRun.updateMany = async () => ({ count: 1 });
  db.dailyQuizRun.create = async ({ data }) => { reservations.push(data); return { ...data, messageId: null }; };
  const run = await claimQuizRun("ny", undefined, new Date(), true, "America/New_York");
  assert.equal(run.dailyRun.day, "2026-10-21");
  assert.equal(run.timezone, "America/New_York");
  assert.equal(bounds[0].gte.toISOString(), "2026-10-21T04:00:00.000Z");
  const refreshed = await refreshRandomQuizRun(run);
  assert.equal(refreshed.timezone, "America/New_York");
  assert.equal(bounds.at(-1).gte.toISOString(), "2026-10-21T04:00:00.000Z");
  db.randomPoll.count = async () => 4;
  await assert.rejects(() => claimQuizRun("ny", undefined, new Date(), true, "Asia/Tokyo"), DailyQuizLimitError);
  db.randomPoll.count = async () => 0;
  db.randomPoll.findFirst = async () => ({ createdAt: new Date(now - 5 * 3600000) });
  for (const zone of ["Asia/Tokyo", "America/New_York"]) {
    await assert.rejects(() => claimQuizRun("ny", undefined, new Date(), true, zone), RandomQuizCooldownError);
  }
  const topics = [{ ...topic, id: "ny" }, { ...topic, id: "tokyo", guildId: "tokyo" }];
  db.topic.findMany = async () => topics;
  stop = startScheduler({}); await bootstrap();
  assert.equal([...timers.values()][0].at, Date.parse("2026-10-22T09:30:00Z"));
  const previousReads = reads;
  scheduleEvents.emit("guildTimezoneChanged", "tokyo", "America/Los_Angeles");
  assert.equal(reads, previousReads, "Changing timezone reschedules cached topics without a query");
  assert.equal([...timers.values()][0].at, Date.parse("2026-10-22T22:30:00Z"), "Another guild's schedule stays unchanged");
  scheduleEvents.emit("topicChanged", { ...topic, id: "new", guildId: "new", timezone: "Asia/Tokyo" });
  assert.equal([...timers.values()][0].at, Date.parse("2026-10-22T09:30:00Z"), "First topic after bootstrap carries its saved guild timezone");
  stop(); stop = undefined;
  let finishLoad;
  db.guildSettings.findMany = () => new Promise(resolve => { finishLoad = resolve; });
  stop = startScheduler({}); await bootstrap();
  scheduleEvents.emit("guildTimezoneChanged", "tokyo", "America/Los_Angeles");
  finishLoad([...settings.values()]); await flush();
  assert.equal([...timers.values()][0].at, Date.parse("2026-10-22T22:30:00Z"), "A timezone changed during bootstrap wins over the stale settings read");
  stop(); stop = undefined;
  assert.equal(scheduleEvents.listenerCount("guildTimezoneChanged"), 0);
  assert.equal(timers.size, 0);
  console.log(JSON.stringify({ check: "guild-timezones", passed: true }));
} finally {
  stop?.(); globalThis.Date = RealDate; globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; await db.$disconnect();
}
