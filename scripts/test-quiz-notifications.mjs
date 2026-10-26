import assert from "node:assert/strict";
import { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } from "discord.js";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const realFetch = globalThis.fetch;
let fetchFixture = async () => { throw new Error("Unexpected network request"); };
globalThis.fetch = (...args) => fetchFixture(...args);
const { db } = await import("../dist/db.js");
const { handleTopic } = await import("../dist/commands/topic.js");
const { publishTopicQuestions, publishRandomQuestion, TopicChannelChangedError } = await import("../dist/services/poll-publisher.js");
const { disablePollControls } = await import("../dist/services/poll-controls.js");
const { runDueTopics } = await import("../dist/scheduler.js");
const { cacheGuildSettings } = await import("../dist/services/guild-settings.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const guildId = "100000000000000001", roleA = "100000000000000002", roleB = "100000000000000003";
const channelId = "100000000000000004", secondChannelId = "100000000000000005";
const settings = { guildId, language: "pl", timezone: "UTC", defaultGenerationTime: "00:00", defaultIntervalDays: 1,
  defaultPollDurationHours: 2, defaultDifficulty: "medium", managerRoleId: null };
cacheGuildSettings(settings);
const topics = new Map(), polls = new Map(), roles = new Map(), sent = [], settlements = [], patches = [];
let writes = 0, roleReads = 0, generated = 0, releases = 0, mentionAll = false;
let onGenerate = () => {}, onRoleRead = () => {};
const guild = { id: guildId, members: { me: { id: "bot" } }, roles: { fetch: async id => {
  roleReads++; onRoleRead(); return roles.get(id) ?? null;
} }, channels: { fetch: async id => channels.get(id) ?? null } };
const permissions = () => new PermissionsBitField(mentionAll ? PermissionsBitField.All :
  PermissionsBitField.All & ~PermissionFlagsBits.Administrator & ~PermissionFlagsBits.MentionEveryone);
const makeChannel = id => ({ id, guildId, guild, type: ChannelType.GuildText, isSendable: () => true,
  permissionsFor: permissions, send: async payload => {
    sent.push(payload); return { id: `quiz-${sent.length}`, channelId: id,
      poll: { allowMultiselect: payload.poll.allowMultiselect, expiresAt: new Date(Date.now() + payload.poll.duration * 3_600_000),
        answers: new Map(payload.poll.answers.map((answer, index) => [index + 7, { id: index + 7, text: answer.text }])) } };
  } });
const channel = makeChannel(channelId), secondChannel = makeChannel(secondChannelId);
const channels = new Map([[channelId, channel], [secondChannelId, secondChannel]]);
roles.set(roleA, { id: roleA, guild, mentionable: true }); roles.set(roleB, { id: roleB, guild, mentionable: true });
db.topic.findUnique = async ({ where }) => topics.get(where.id) ?? [...topics.values()].find(topic =>
  topic.guildId === where.guildId_name?.guildId && topic.name === where.guildId_name?.name) ?? null;
db.topic.findMany = async () => [...topics.values()].filter(topic => topic.enabled);
db.topic.create = async ({ data }) => {
  writes++; const topic = { id: `topic-${topics.size}`, enabled: true, lastGeneratedAt: null, questionsGenerated: 0, ...data };
  topics.set(topic.id, topic); return { ...topic };
};
db.topic.update = async ({ where, data }) => {
  writes++; const topic = topics.get(where.id);
  const increment = data.questionsGenerated?.increment;
  Object.assign(topic, data, increment ? { questionsGenerated: topic.questionsGenerated + increment } : {});
  return { ...topic };
};
db.generatedPoll.findMany = db.randomPoll.findMany = db.dailyQuizRun.findMany = async () => [];
db.generatedPoll.count = db.randomPoll.count = async () => 0;
db.randomPoll.findFirst = async () => null;
db.dailyQuizRun.create = async ({ data }) => ({ ...data, createdAt: new Date(), messageId: null });
db.dailyQuizRun.update = async ({ data }) => data;
db.dailyQuizRun.updateMany = async () => ({ count: 1 });
db.dailyQuizRun.deleteMany = async () => { releases++; return { count: 1 }; };
db.generatedPoll.create = async ({ data }) => { polls.set(data.messageId, data); return data; };
db.randomPoll.create = async ({ data }) => data;
db.generatedPoll.findUnique = async ({ where }) => polls.get(where.messageId);
db.generatedPoll.updateMany = async () => ({ count: 1 });
db.quizSettlement.create = async ({ data }) => { settlements.push(data); return data; };
db.quizChannel.findUnique = async () => ({ channelId });
db.$transaction = async work => work(db);
const realWarn = console.warn, realLog = console.log;
console.warn = () => {};
fetchFixture = async () => {
  generated++; onGenerate();
  const question = { language: "pl", topic: "Test", question: `Pytanie ${generated}?`, options: ["A", "B"],
    optionEmojis: ["", ""], topicEmoji: "", correctOption: 0, explanation: "Fakt." };
  return new Response(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message",
    content: [{ type: "output_text", text: JSON.stringify(question) }] }] }), { headers: { "content-type": "application/json" } });
};
async function command(action, values, permitted = true) {
  const replies = [];
  await handleTopic({ user: { id: "actor" }, guildId, guild, channelId, channel, locale: "pl", member: { roles: [] },
    memberPermissions: { has: () => permitted }, options: { getSubcommand: () => action,
      getString: name => values[name] ?? null, getInteger: name => values[name] ?? null, getRole: name => values[name] ?? null,
      getChannel: name => values[name] ?? null, getBoolean: name => values[name] ?? null },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral), editReply: async payload => {
      assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload.content);
    } });
  return replies.at(-1);
}
try {
  await command("create", { name: "Quiz", option_count: 2 });
  const topic = [...topics.values()][0]; assert.equal(topic.pingRoleId, null);
  const deniedBefore = { writes, roleReads };
  assert.equal(await command("configure", { name: "Quiz", ping_role: { id: roleA } }, false), message("pl", "permission"));
  assert.deepEqual({ writes, roleReads }, deniedBefore);
  assert.equal(await command("configure", { name: "Quiz", ping_role: { id: roleA }, clear_ping: true }), message("pl", "quizPingConflict"));
  assert.equal(writes, deniedBefore.writes);
  for (const id of [guildId, "deleted", "foreign"]) {
    roles.set("foreign", { id: "foreign", guild: { id: "another" }, mentionable: true });
    assert.equal(await command("configure", { name: "Quiz", ping_role: { id } }), message("pl", "quizPingRoleInvalid"));
  }
  roles.get(roleA).mentionable = false;
  assert.equal(await command("configure", { name: "Quiz", ping_role: { id: roleA } }), message("pl", "quizPingPermissions"));
  assert.equal(topic.pingRoleId, null);
  mentionAll = true;
  assert.ok((await command("configure", { name: "Quiz", ping_role: { id: roleA } })).includes(`<@&${roleA}>`));
  assert.equal(topic.pingRoleId, roleA);
  await command("configure", { name: "Quiz", duration_hours: 3 }); assert.equal(topic.pingRoleId, roleA);
  mentionAll = false;
  assert.equal(await command("configure", { name: "Quiz", channel: secondChannel }), message("pl", "quizPingPermissions"));
  assert.equal(topic.channelId, channelId);
  await command("configure", { name: "Quiz", channel: secondChannel, clear_ping: true });
  assert.equal(topic.channelId, secondChannelId); assert.equal(topic.pingRoleId, null);
  roles.get(roleA).mentionable = true;
  await command("configure", { name: "Quiz", channel, ping_role: { id: roleA } });
  console.log = () => {};
  await runDueTopics({ channels: { fetch: async () => channel } });
  console.log = realLog;
  assert.equal(sent.length, 1);
  assert.ok(sent[0].content.startsWith(`<@&${roleA}>\n`));
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [roleA], users: [], repliedUser: false });
  topic.lastGeneratedAt = null;
  await command("run", { name: "Quiz" });
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].allowedMentions.roles, [roleA]);
  await disablePollControls({ rest: { patch: async (_, payload) => patches.push(payload.body) } }, channelId, settlements.at(-1).messageId, "pl");
  assert.equal(patches.length, 1); assert.deepEqual(patches[0].allowed_mentions.parse, []);
  assert.equal(patches[0].content, undefined);
  topic.lastGeneratedAt = null;
  onGenerate = () => { topic.pingRoleId = roleB; };
  await publishTopicQuestions({ ...topic }, channel, false);
  assert.deepEqual(sent.at(-1).allowedMentions.roles, [roleB]);
  onGenerate = () => {};
  topic.lastGeneratedAt = null;
  onRoleRead = () => { topic.pingRoleId = null; };
  await publishTopicQuestions({ ...topic, pingRoleId: roleB }, channel, false);
  assert.deepEqual(sent.at(-1).allowedMentions.roles, []);
  onRoleRead = () => {};
  topic.pingRoleId = roleA; topic.lastGeneratedAt = null; roles.delete(roleA);
  await publishTopicQuestions({ ...topic }, channel, false);
  assert.deepEqual(sent.at(-1).allowedMentions.roles, []);
  roles.set(roleA, { id: roleA, guild, mentionable: false }); topic.lastGeneratedAt = null;
  await publishTopicQuestions({ ...topic }, channel, false);
  assert.deepEqual(sent.at(-1).allowedMentions.roles, []);
  roles.get(roleA).mentionable = true; topic.lastGeneratedAt = null;
  const beforeMove = { sent: sent.length, releases };
  onRoleRead = () => { topic.channelId = secondChannelId; };
  await assert.rejects(publishTopicQuestions({ ...topic }, channel, false), TopicChannelChangedError);
  assert.equal(sent.length, beforeMove.sent); assert.equal(releases, beforeMove.releases + 1);
  onRoleRead = () => {}; topic.channelId = channelId;
  const beforeRandom = roleReads;
  await publishRandomQuestion(guildId, 2, channel);
  assert.equal(roleReads, beforeRandom);
  assert.deepEqual(sent.at(-1).allowedMentions.parse, []);
  assert.doesNotMatch(sent.at(-1).content, /<@&/);
  await command("configure", { name: "Quiz", clear_ping: true }); topic.lastGeneratedAt = null;
  const beforeNoPing = roleReads;
  await publishTopicQuestions({ ...topic }, channel, false);
  assert.equal(roleReads, beforeNoPing); assert.deepEqual(sent.at(-1).allowedMentions.roles, []);
  for (const payload of sent) {
    assert.equal(payload.poll.allowMultiselect, false);
    assert.equal(payload.poll.answers.length, 2);
    assert.equal(payload.embeds, undefined);
    const buttons = payload.components.flatMap(row => row.toJSON().components);
    assert.deepEqual(buttons.map(button => button.custom_id), ["quiz:end"]);
  }
  await command("create", { name: "Drugi quiz", option_count: 2, ping_role: { id: roleA } });
  assert.equal([...topics.values()].find(row => row.name === "Drugi quiz").pingRoleId, roleA);
  for (const language of messageLanguages) {
    assert.doesNotMatch(message(language, "quizPingSummary", { role: message(language, "disabled") }), /\{\w+\}/);
  }
  realLog(JSON.stringify({ check: "quiz-notifications", passed: true, locales: 6, scheduledAndEarlyRun: true,
    roleWhitelist: true, randomSilent: true, closeSilent: true, defaultsOff: true, currentSettings: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "quiz-notifications", passed: false,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-quiz-notifications\.mjs:(\d+)/)?.[1] ?? 0),
    counts: { sends: sent.length, generated, roleReads, releases, topics: topics.size } }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch; console.warn = realWarn; console.log = realLog; await db.$disconnect();
}
