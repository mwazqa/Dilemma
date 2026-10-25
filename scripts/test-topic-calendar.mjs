import assert from "node:assert/strict";
import { quizGuild } from "./fixtures/quiz-channel.mjs";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", QUIZ_TIMEZONE: "Europe/Warsaw", OPENAI_API_KEY: "test" });
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request in calendar test"); };
const RealDate = Date;
let now = Date.parse("2026-10-21T08:00:00Z");
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { db } = await import("../dist/db.js");
const { isScheduleDate, isTopicDue, nextTopicRunAt, claimQuizRun, releaseQuizRun, TopicScheduleNotReadyError } = await import("../dist/services/quiz-limits.js");
const { handleTopic, topicCommand } = await import("../dist/commands/topic.js");
const { getHelpContent, getHelpEmbed } = await import("../dist/commands/help.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const topics = new Map(), runs = new Map();
let settings = { guildId: "guild", language: "pl", defaultIntervalDays: 1, defaultPollDurationHours: 24,
  defaultGenerationTime: null, defaultDifficulty: "medium" };
db.guildSettings.findUnique = async () => settings;
const key = row => [row.guildId, row.scope, row.day, row.slot].join("|");
db.topic.findUnique = async ({ where }) => topics.get(where.id) ?? [...topics.values()].find(topic =>
  topic.guildId === where.guildId_name?.guildId && topic.name === where.guildId_name?.name) ?? null;
db.topic.findMany = async ({ where }) => [...topics.values()].filter(topic => topic.guildId === where.guildId);
db.topic.create = async ({ data }) => {
  const topic = { id: `topic-${topics.size}`, enabled: true, lastGeneratedAt: null, questionsGenerated: 0, ...data };
  topics.set(topic.id, topic); return { ...topic };
};
db.topic.update = async ({ where, data }) => { const topic = topics.get(where.id); Object.assign(topic, data); return { ...topic }; };
db.dailyQuizRun.findMany = async ({ where }) => [...runs.values()].filter(row =>
  row.guildId === where.guildId && row.scope === where.scope && row.day === where.day).map(row => ({ ...row }));
db.dailyQuizRun.create = async ({ data }) => {
  if (runs.has(key(data))) throw new Prisma.PrismaClientKnownRequestError("Duplicate fixture reservation", { code: "P2002", clientVersion: "test" });
  const row = { createdAt: new Date(), messageId: null, ...data }; runs.set(key(row), row); return { ...row };
};
db.dailyQuizRun.deleteMany = async ({ where }) => {
  const row = runs.get(key(where));
  if (!row || +row.createdAt !== +where.createdAt || row.messageId !== where.messageId) return { count: 0 };
  runs.delete(key(row)); return { count: 1 };
};
db.generatedPoll.count = async () => 0;
let transactionQueue = Promise.resolve();
db.$transaction = work => {
  const job = transactionQueue.then(async () => {
    const snapshot = [...runs].map(([id, row]) => [id, { ...row }]);
    try { return await work(db); } catch (error) { runs.clear(); for (const [id, row] of snapshot) runs.set(id, row); throw error; }
  });
  transactionQueue = job.catch(() => {}); return job;
};
function request(subcommand, values, permitted = true) {
  const replies = [];
  return { user: { id: "100000000000000001" }, replies, guildId: "guild", guild: quizGuild(), channelId: "channel", channel: { isSendable: () => true }, locale: "pl", memberPermissions: { has: () => permitted },
    options: { getSubcommand: () => subcommand, getRole: name => values[name] ?? null, getBoolean: name => values[name] ?? null, getChannel: name => values[name] ?? null, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
    deferReply: async () => {}, editReply: async value => replies.push(typeof value === "string" ? value : value.content ?? value),
    followUp: async value => replies.push(value.content) };
}
const calendar = { enabled: true, channelId: "channel", generationTime: "18:00", startDate: "2026-10-26", intervalDays: 7, lastGeneratedAt: null };
try {
  for (const date of ["2026-10-26", "2028-02-29", "2026-12-31"]) assert.equal(isScheduleDate(date), true);
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-02", "2026-10-26T18:00", "", "none"]) assert.equal(isScheduleDate(date), false);
  assert.equal(nextTopicRunAt(calendar, new Date()), Date.parse("2026-10-26T17:00:00Z"));
  assert.equal(isTopicDue(calendar, new Date(), true), false);
  assert.equal(isTopicDue(calendar, new Date("2026-10-26T08:00:00Z")), false);
  assert.equal(isTopicDue(calendar, new Date("2026-10-26T08:00:00Z"), true), true);
  assert.equal(isTopicDue(calendar, new Date("2026-10-26T17:00:00Z")), true);
  const late = { ...calendar, lastGeneratedAt: new Date("2026-10-28T10:00:00Z") };
  assert.equal(nextTopicRunAt(late, new Date("2026-10-29T10:00:00Z")), Date.parse("2026-11-02T17:00:00Z"), "Late publication cannot drift the fixed weekday");
  assert.equal(isTopicDue(calendar, new Date("2026-10-27T08:00:00Z")), true, "Catch up a missed slot before today's publication hour");
  assert.equal(nextTopicRunAt({ ...calendar, lastGeneratedAt: new Date("2026-10-26T08:00:00Z") }, new Date("2026-10-26T09:00:00Z")), Date.parse("2026-11-02T17:00:00Z"));
  const spring = { ...calendar, startDate: "2026-03-29", generationTime: "02:30", intervalDays: 1 };
  assert.equal(nextTopicRunAt(spring, new Date("2026-03-29T00:00:00Z")), Date.parse("2026-03-29T01:00:00Z"));
  const autumn = { ...calendar, startDate: "2026-10-25", generationTime: "02:30", intervalDays: 1 };
  assert.equal(nextTopicRunAt(autumn, new Date("2026-10-25T00:00:00Z")), Date.parse("2026-10-25T00:30:00Z"));
  assert.equal(isTopicDue(autumn, new Date("2026-10-25T01:15:00Z")), true, "A repeated local hour cannot hide an already-due first occurrence");
  assert.equal(isTopicDue({ ...autumn, lastGeneratedAt: new Date("2026-10-25T00:30:00Z") }, new Date("2026-10-25T01:30:00Z")), false);
  assert.equal(nextTopicRunAt({ ...calendar, startDate: "2026-12-31", lastGeneratedAt: new Date("2026-12-31T17:00:00Z") },
    new Date("2027-01-01T10:00:00Z")), Date.parse("2027-01-07T17:00:00Z"));
  const missingTime = request("create", { name: "Missing time", option_count: 4, start_date: "2026-10-26" });
  await handleTopic(missingTime);
  assert.equal(missingTime.replies[0], message("pl", "scheduleTimeRequired"));
  assert.equal(topics.size, 0);
  for (const date of ["2026-02-30", "2026-10-20", "2026-1-01"]) {
    const invalid = request("create", { name: "Invalid", option_count: 4, start_date: date, generation_time: "18:00" });
    await handleTopic(invalid); assert.equal(invalid.replies[0], message("pl", "dateInvalid"));
  }
  for (let offset = 0; offset < 7; offset++) {
    const date = `2026-10-${22 + offset}`;
    const command = request("create", { name: `Week ${offset}`, option_count: 4, start_date: date, generation_time: "18:00", interval_days: 7 });
    await handleTopic(command);
    const topic = [...topics.values()].at(-1);
    assert.equal(topic.startDate, date); assert.equal(topic.intervalDays, 7);
    assert.equal(nextTopicRunAt(topic), Date.parse(date + (offset < 3 ? "T16:00:00Z" : "T17:00:00Z")));
    assert.ok(command.replies.at(-1).includes(date) && command.replies.at(-1).includes("Europe/Warsaw"));
  }
  assert.equal(topics.size, 7);
  const first = [...topics.values()][0];
  await handleTopic(request("configure", { name: first.name, interval_days: 3 }));
  assert.equal(first.startDate, "2026-10-22"); assert.equal(first.intervalDays, 3);
  const duplicate = request("create", { name: first.name, option_count: 2 });
  await handleTopic(duplicate);
  assert.equal(duplicate.replies.at(-1), message("pl", "topicExists", { name: first.name }));
  assert.equal(first.startDate, "2026-10-22"); assert.equal(first.intervalDays, 3); assert.equal(first.generationTime, "18:00");
  const before = { ...first };
  await handleTopic(request("configure", { name: first.name, start_date: "2026-02-30" }));
  assert.deepEqual(first, before);
  const denied = request("configure", { name: first.name, start_date: "2026-10-30" }, false);
  await handleTopic(denied); assert.deepEqual(first, before);
  const listing = request("list", {}); await handleTopic(listing); assert.ok(listing.replies[0].embeds[0].toJSON().fields.some(field => field.name.includes("2026-10-22")));
  const blocked = request("run", { name: first.name });
  await handleTopic(blocked); assert.equal(blocked.replies.at(-1), message("pl", "topicScheduleUnavailable"));
  assert.equal(runs.size, 0);
  now = Date.parse("2026-10-22T08:00:00Z");
  const parallel = await Promise.allSettled(Array.from({ length: 8 }, () => claimQuizRun("guild", first.id)));
  assert.equal(parallel.filter(item => item.status === "fulfilled").length, 1);
  const lease = parallel.find(item => item.status === "fulfilled").value;
  assert.equal(runs.size, 2); assert.equal(lease.cycleRun.day, "2026-10-22");
  now += 86_400_000;
  await assert.rejects(claimQuizRun("guild", first.id), TopicScheduleNotReadyError);
  assert.equal(runs.size, 2, "An uncertain send holds the whole cycle, even after midnight; duplicate claim rolls back its daily row");
  await releaseQuizRun(lease); assert.equal(runs.size, 0);
  const lateLease = await claimQuizRun("guild", first.id);
  assert.equal(lateLease.cycleRun.day, "2026-10-22");
  first.lastGeneratedAt = new Date();
  assert.equal(nextTopicRunAt(first), Date.parse("2026-10-25T17:00:00Z"));
  await handleTopic(request("configure", { name: first.name, start_date: "none" }));
  assert.equal(first.startDate, null); assert.equal(first.lastGeneratedAt.getTime(), now);
  const backlog = { ...first, id: "backlog-calendar", startDate: "2026-10-19", intervalDays: 7, lastGeneratedAt: null };
  topics.set(backlog.id, backlog);
  now = Date.parse("2026-10-26T08:00:00Z");
  const scheduled = await claimQuizRun("guild", backlog.id, new Date(), false);
  assert.equal(scheduled.cycleRun.day, "2026-10-19", "Automatic catch-up claims the overdue slot, not today's still-future slot");
  await releaseQuizRun(scheduled);
  const early = await claimQuizRun("guild", backlog.id);
  assert.equal(early.cycleRun.day, "2026-10-26", "An explicit early manual run may claim today's slot");
  await releaseQuizRun(early);
  for (const language of messageLanguages) {
    assert.ok(getHelpContent(language).includes("start_date"));
    assert.ok(getHelpEmbed(language).toJSON().description.includes("interval_days"));
    for (const key of ["dateInvalid", "scheduleTimeRequired", "topicScheduleUnavailable"]) assert.ok(message(language, key).includes("~"));
  }
  for (const command of ["create", "configure"]) assert.ok(topicCommand.toJSON().options.find(option => option.name === command).options.some(option => option.name === "start_date"));
  const readme = readFileSync("README.md", "utf8");
  assert.ok(readme.includes("start_date") && readme.includes("20261021120000_topic_start_date"));
  console.log(JSON.stringify({ ok: true, sevenIndependentDates: true, fixedRecurrence: true, dst: true, cycleReservations: true, permissions: true, localizedHelp: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "topic-calendar", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-topic-calendar\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { globalThis.Date = RealDate; globalThis.fetch = realFetch; await db.$disconnect(); }
