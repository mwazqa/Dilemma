import assert from "node:assert/strict";
import { quizAnswers, quizDuration } from "./fixtures/native-quiz.mjs";
import { Prisma } from "@prisma/client";
import { quizGuild } from "./fixtures/quiz-channel.mjs";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test",
  AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0", QUIZ_TIMEZONE: "Europe/Warsaw" });
const realFetch = globalThis.fetch;
let fetchFixture = async () => { throw new Error("Unexpected network request in UX test"); };
globalThis.fetch = (...args) => fetchFixture(...args);
const { db } = await import("../dist/db.js");
db.quizChannel.findUnique = async ({ where }) => ({ channelId: where.guildId_channelId.channelId });
const { handleTopic, handleTopicAutocomplete } = await import("../dist/commands/topic.js");
const { dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { getHelpEmbed } = await import("../dist/commands/help.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const topics = new Map();
let settings = { guildId: "guild", language: "pl", defaultIntervalDays: 7, defaultPollDurationHours: 12,
  defaultGenerationTime: "18:30", defaultDifficulty: "medium" };
let writes = 0, reservations = 0, requests = 0, releases = 0, deliveries = 0;
let generatedAnswers = ["A", "B", "C", "D"];
let prompt, sent, savedPoll;
let beforeUpdate = () => {};
db.guildSettings.findUnique = async () => settings;
db.topic.findUnique = async ({ where }) => topics.get(where.id) ?? [...topics.values()].find(topic =>
  topic.guildId === where.guildId_name?.guildId && topic.name === where.guildId_name?.name) ?? null;
db.topic.findMany = async () => [...topics.values()];
db.topic.create = async ({ data }) => {
  if ([...topics.values()].some(topic => topic.name === data.name && topic.guildId === data.guildId)) {
    throw new Prisma.PrismaClientKnownRequestError("Fixture duplicate", { code: "P2002", clientVersion: "test" });
  }
  writes++;
  const topic = { id: `topic-${topics.size}`, enabled: true, lastGeneratedAt: null, questionsGenerated: 0, ...data };
  topics.set(topic.id, topic); return { ...topic };
};
db.topic.update = async ({ where, data }) => {
  beforeUpdate();
  const topic = topics.get(where.id);
  if (("startDate" in where && where.startDate !== topic.startDate) || ("generationTime" in where && where.generationTime !== topic.generationTime)) {
    throw new Prisma.PrismaClientKnownRequestError("Fixture changed", { code: "P2025", clientVersion: "test" });
  }
  writes++; Object.assign(topic, data); return { ...topic };
};
db.dailyQuizRun.findMany = async () => [];
db.dailyQuizRun.create = async ({ data }) => { reservations++; return { ...data, createdAt: new Date(), messageId: null }; };
db.dailyQuizRun.updateMany = async () => ({ count: 1 });
db.dailyQuizRun.deleteMany = async () => { releases++; return { count: 1 }; };
db.randomPoll.count = async () => 0;
db.generatedPoll.count = async () => 0;
db.randomPoll.findMany = async () => [];
db.generatedPoll.findMany = async () => [];
db.randomPoll.findFirst = async () => null;
db.randomPoll.create = async ({ data }) => { savedPoll = data; return data; };
db.quizSettlement.create = async ({ data }) => data;
db.$transaction = async work => work(db);
fetchFixture = async (_, options) => {
  requests++;
  const body = JSON.parse(options.body);
  prompt = body.input;
  const question = { language: "pl", topic: "Test", question: `Pytanie ${requests}?`, options: generatedAnswers,
    topicEmoji: "", optionEmojis: generatedAnswers.map(() => ""), correctOption: generatedAnswers.length - 1, explanation: "Krótki fakt." };
  return new Response(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(question) }] }] }), { headers: { "content-type": "application/json" } });
};
const channel = { id: "channel", isSendable: () => true, send: async payload => {
  deliveries++; sent = payload;
  return { id: `message-${deliveries}`, channelId: "channel", poll: { expiresAt: new Date(Date.now() + 3600000),
    answers: new Map(quizAnswers(payload).map((answer, index) => [index + 7, { id: index + 7, text: answer.text }])) } };
} };
function request(subcommand, values = {}, permitted = true) {
  const replies = [];
  return { user: { id: "actor" }, replies, guildId: "guild", guild: quizGuild("guild", [{ ...channel, guildId: "guild", type: 0, permissionsFor: () => ({ has: () => true }) }]), channelId: "channel", channel, locale: "pl", memberPermissions: { has: () => permitted },
    options: { getSubcommand: () => subcommand, getRole: name => values[name] ?? null, getBoolean: name => values[name] ?? null, getChannel: name => values[name] ?? null, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
    deferReply: async () => {}, editReply: async payload => replies.push(payload.content ?? payload) };
}
async function invoke(subcommand, values = {}, permitted = true) {
  const interaction = request(subcommand, values, permitted); await handleTopic(interaction); return interaction;
}
async function invalid(subcommand, values, key) {
  const before = { writes, reservations, requests, deliveries };
  const interaction = await invoke(subcommand, values);
  assert.equal(interaction.replies.at(-1), message("pl", key));
  assert.deepEqual({ writes, reservations, requests, deliveries }, before);
}
try {
  const menu = dilemmaCommand.toJSON();
  const find = name => menu.options.find(option => option.name === name);
  const names = option => option.options.map(field => field.name);
  assert.deepEqual(names(find("create")), ["name", "channel", "ping_role", "start_date", "generation_time", "interval_days", "duration_hours", "difficulty", "option_count"]);
  assert.deepEqual(names(find("configure")), ["name", "channel", "ping_role", "clear_ping", "start_date", "generation_time", "interval_days", "duration_hours", "difficulty", "option_count"]);
  assert.equal(find("create").options[0].autocomplete, false);
  assert.equal(find("configure").options[0].autocomplete, true);
  assert.deepEqual(names(find("random")), ["options", "option_count", "difficulty", "duration_hours"]);
  assert.ok(find("random").options.every(option => !option.required));
  assert.deepEqual(names(find("timezone")), ["value"]);
  assert.equal(find("defaults"), undefined);
  assert.deepEqual(menu.options.map(option => option.name), ["random", "score", "create", "configure", "list", "run", "enable", "disable", "language", "timezone", "random-channels", "permissions", "poll", "help", "ping", "delete"]);
  function validateOptions(command) {
    if (command.description) {
      assert.ok(command.description.length <= 100);
      assert.doesNotMatch(command.description, /[~♡✧]/);
    }
    let optional = false;
    for (const option of command.options ?? []) {
      if (option.type > 2) {
        if (!option.required) optional = true;
        else assert.equal(optional, false);
      }
      validateOptions(option);
    }
  }
  validateOptions(menu);
  await invalid("create", { name: "   " }, "nameInvalid");
  const created = await invoke("create", { name: "New" });
  const topic = [...topics.values()][0];
  assert.equal(topic.optionCount, 4); assert.equal(topic.options, "");
  assert.equal(topic.generationTime, "18:30"); assert.equal(topic.pollDurationHours, 12); assert.equal(topic.intervalDays, 7);
  assert.ok(created.replies[0].includes("12 h"));
  assert.match(created.replies[0], /\n\n\*\*New\*\*\n\n- \*\*Status:\*\*/);
  assert.equal(created.replies[0].split("\n").filter(line => line.startsWith("- ")).length, 9);
  const beforeDuplicate = { ...topic };
  const duplicate = await invoke("create", { name: "New", duration_hours: 1, option_count: 2 });
  assert.equal(duplicate.replies[0], message("pl", "topicExists", { name: "New" }));
  assert.deepEqual(topic, beforeDuplicate);
  await invalid("configure", { name: "New" }, "settingsMissing");
  const missing = await invoke("configure", { name: "Missing", duration_hours: 2 });
  assert.equal(missing.replies[0], message("pl", "missing", { name: "Missing" }));
  assert.equal(topics.size, 1);
  const denied = await invoke("create", { name: "Denied" }, false);
  assert.equal(denied.replies[0], message("pl", "permission")); assert.equal(topics.size, 1);
  topic.enabled = false; topic.lastGeneratedAt = new Date("2026-01-01T08:00:00Z"); topic.questionsGenerated = 9;
  await invoke("configure", { name: "New", duration_hours: 3, option_count: 2 });
  assert.equal(topic.pollDurationHours, 3); assert.equal(topic.optionCount, 2);
  assert.equal(topic.enabled, false); assert.equal(topic.questionsGenerated, 9);
  assert.equal(+topic.lastGeneratedAt, Date.parse("2026-01-01T08:00:00Z")); assert.equal(topic.channelId, "channel");
  topic.options = "Legacy A, Legacy B";
  await invoke("configure", { name: "New", duration_hours: 4 }); assert.equal(topic.options, "Legacy A, Legacy B");
  await invoke("configure", { name: "New", option_count: 3 }); assert.equal(topic.options, "");
  for (const subcommand of ["create", "configure"]) {
    const name = subcommand === "create" ? "Invalid" : "New";
    for (const value of [1, 5, 2.5]) await invalid(subcommand, { name, option_count: value }, "optionCountInvalid");
    for (const value of [0, 31, 1.5]) await invalid(subcommand, { name, interval_days: value }, "intervalInvalid");
    for (const value of [0, 25, 1.5]) await invalid(subcommand, { name, duration_hours: value }, "durationInvalid");
    await invalid(subcommand, { name, start_date: "2030-02-30" }, "dateInvalid");
    await invalid(subcommand, { name, generation_time: "24:00" }, "timeInvalid");
  }
  const dated = await invoke("create", { name: "Dated", start_date: "2030-01-01", duration_hours: 1, option_count: 2 });
  const calendar = [...topics.values()].at(-1);
  assert.equal(calendar.startDate, "2030-01-01"); assert.equal(calendar.generationTime, "18:30");
  assert.ok(dated.replies[0].includes("2030-01-01"));
  await invalid("configure", { name: "Dated", generation_time: "none" }, "scheduleTimeRequired");
  assert.equal(calendar.generationTime, "18:30");
  await invoke("configure", { name: "Dated", start_date: "none", generation_time: "none" });
  assert.equal(calendar.startDate, null); assert.equal(calendar.generationTime, null);
  await invalid("configure", { name: "Dated", start_date: "2030-01-02" }, "scheduleTimeRequired");
  calendar.generationTime = "18:30";
  beforeUpdate = () => { calendar.generationTime = null; };
  await invalid("configure", { name: "Dated", start_date: "2030-01-02" }, "topicChanged");
  assert.equal(calendar.startDate, null); assert.equal(calendar.generationTime, null);
  beforeUpdate = () => {};
  const noTime = await invoke("create", { name: "Manual", generation_time: "none" });
  assert.ok(noTime.replies[0].includes(message("pl", "manualPublication"))); assert.equal([...topics.values()].at(-1).generationTime, null);
  await invalid("create", { name: "Missing time", start_date: "2030-01-01", generation_time: "none" }, "scheduleTimeRequired");
  await invalid("run", { name: "New", duration_hours: 25 }, "durationInvalid");
  for (const value of ["", "A", "A,A", "A,a", "A, ,B", "A,B,", "A,B,C,D,E", `${"a".repeat(56)},B`]) {
    await invalid("random", { options: value }, "optionsInvalid");
  }
  await invalid("random", { options: "A,B", option_count: 4 }, "optionsMismatch");
  await invalid("random", { option_count: 1 }, "optionCountInvalid");
  await invalid("random", { duration_hours: 25 }, "durationInvalid");
  const random = await invoke("random", {}, false);
  assert.ok(random.replies.at(-1).includes("Quiz gotowy"));
  assert.equal(savedPoll.creatorUserId, "actor");
  assert.equal(quizAnswers(sent).length, 4); assert.equal(quizDuration(sent), 12);
  generatedAnswers = ["Yes", "No"];
  await invoke("random", { options: " Yes, No ", duration_hours: 2 }, false);
  assert.match(prompt, /Use exactly these answer options: Yes, No/);
  assert.deepEqual(quizAnswers(sent).map(answer => answer.text), ["Yes", "No"]);
  assert.equal(quizDuration(sent), 2); assert.deepEqual(JSON.parse(savedPoll.options), ["Yes", "No"]);
  await invoke("random", { options: "Yes,No", option_count: 2 });
  generatedAnswers = ["A", "B", "C"];
  await invoke("random", { option_count: 3 }); assert.equal(quizAnswers(sent).length, 3);
  const beforeWrongAnswers = { deliveries, releases };
  const wrong = await invoke("random", { options: "Yes,No" });
  assert.equal(wrong.replies.at(-1), message("pl", "aiInvalidResponse"));
  assert.equal(deliveries, beforeWrongAnswers.deliveries); assert.ok(releases > beforeWrongAnswers.releases);
  const successfulFetch = fetchFixture;
  for (const subcommand of ["random", "run"]) {
    topic.lastGeneratedAt = null;
    const values = subcommand === "run" ? { name: "New" } : {};
    for (const [status, key] of [[404, "aiUnavailable"], [429, "quota"], [401, "aiConfiguration"], [403, "aiConfiguration"]]) {
      const before = { deliveries, releases };
      fetchFixture = async () => new Response(JSON.stringify({ error: { message: "Fixture private provider details" } }), {
        status, headers: { "content-type": "application/json" } });
      const failed = await invoke(subcommand, values);
      assert.equal(failed.replies.at(-1), message("pl", key));
      assert.equal(deliveries, before.deliveries);
      assert.ok(releases > before.releases, "AI failure releases reservations before any Discord send");
      assert.doesNotMatch(failed.replies.at(-1), /Fixture|uprawnienia/);
    }
  }
  fetchFixture = successfulFetch; generatedAnswers = ["A", "B", "C", "D"]; topic.optionCount = 4;
  const successfulSend = channel.send;
  for (const subcommand of ["random", "run"]) {
    const values = subcommand === "run" ? { name: "New" } : {};
    for (const code of [50013, 50001, 50000]) {
      channel.send = async () => { deliveries++; throw { code, message: "Fixture private Discord details" }; };
      const before = { requests, deliveries, releases };
      const failed = await invoke(subcommand, values);
      assert.equal(failed.replies.at(-1), message("pl", code === 50000 ? "generationFailed" : "publishPermission"));
      assert.equal(requests, before.requests + 1); assert.equal(deliveries, before.deliveries + 1);
      assert.equal(releases, before.releases, "Never release uncertain sends or publish twice");
      assert.doesNotMatch(failed.replies.at(-1), /Fixture/);
    }
  }
  channel.send = successfulSend;
  await handleTopicAutocomplete({ guildId: "guild", options: { getFocused: () => ({ name: "name", value: "" }), getSubcommand: () => "create" },
    respond: async choices => assert.deepEqual(choices, []) });
  const beforeRace = writes;
  const race = await Promise.all([invoke("create", { name: "Concurrent" }), invoke("create", { name: "Concurrent" })]);
  assert.equal(writes, beforeRace + 1);
  assert.equal(race.filter(item => item.replies.at(-1) === message("pl", "topicExists", { name: "Concurrent" })).length, 1);
  for (const language of messageLanguages) {
    const help = getHelpEmbed(language).toJSON();
    assert.equal(help.description, undefined);
    assert.ok(help.fields.every(field => field.value.length < 1024));
    assert.ok(message(language, "languagePlaceholder").length <= 150);
    for (const key of ["aiUnavailable", "aiInvalidResponse", "aiConfiguration", "publishPermission", "generationFailed"]) {
      assert.ok(message(language, key).includes("~") && message(language, key).length < 2000);
    }
  }
  console.log(JSON.stringify({ check: "command-ux", passed: true, sharedFields: true, dependentFields: true, noInvalidWrites: true,
    createOnly: true, configurePreservesState: true, customRandomAnswers: true, aiAnswerContract: true, localizedHelp: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "command-ux", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-command-ux\.mjs:(\d+)/)?.[1] ?? 0) })); process.exitCode = 1;
} finally { globalThis.fetch = realFetch; await db.$disconnect(); }
