import assert from "node:assert/strict";
import { quizAnswers, quizDuration } from "./fixtures/native-quiz.mjs";
import { Prisma } from "@prisma/client";
import { ChannelType, PermissionFlagsBits, PermissionsBitField, MessageFlags } from "discord.js";
Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const { db } = await import("../dist/db.js");
const { handleChannels, channelsCommand } = await import("../dist/commands/channels.js");
const { RandomQuizChannelError, canUseRandomQuizChannel } = await import("../dist/services/quiz-channels.js");
const { message } = await import("../dist/messages.js");
const assigned = new Map(), topics = new Map();
let writes = 0, claims = 0, released = 0, aiCalls = 0, sends = 0, fetches = 0, generated;
let onGenerate = () => {};
let lastFeedback = null;
const settings = guildId => ({ guildId, language: "pl", managerRoleId: "manager", defaultDifficulty: "medium",
  defaultIntervalDays: 7, defaultPollDurationHours: 2, defaultGenerationTime: null });
const key = row => `${row.guildId}:${row.channelId}`;
db.guildSettings.findUnique = async ({ where }) => settings(where.guildId);
db.quizChannel.findUnique = async ({ where }) => assigned.get(key(where.guildId_channelId)) ?? null;
db.quizChannel.findMany = async ({ where }) => [...assigned.values()].filter(row => row.guildId === where.guildId);
db.quizChannel.findFirst = async ({ where }) => [...assigned.values()].find(row => row.guildId === where.guildId) ?? null;
db.quizChannel.upsert = async ({ create }) => { writes++; assigned.set(key(create), create); return create; };
db.quizChannel.deleteMany = async ({ where }) => { writes++; return { count: Number(assigned.delete(key(where))) }; };
db.topic.findUnique = async ({ where }) => topics.get(where.id) ?? [...topics.values()].find(row =>
  row.guildId === where.guildId_name?.guildId && row.name === where.guildId_name?.name) ?? null;
db.topic.findMany = async () => [...topics.values()];
db.topic.create = async ({ data }) => {
  const row = { id: `topic-${topics.size}`, enabled: true, questionsGenerated: 0, lastGeneratedAt: null, ...data };
  topics.set(row.id, row); return { ...row };
};
db.topic.update = async ({ where, data }) => {
  const row = topics.get(where.id);
  const next = { ...data };
  if (data.questionsGenerated) next.questionsGenerated = row.questionsGenerated + data.questionsGenerated.increment;
  Object.assign(row, next); return { ...row };
};
db.dailyQuizRun.findMany = async () => [];
db.dailyQuizRun.create = async ({ data }) => { claims++; return { ...data, createdAt: new Date(), messageId: null }; };
db.dailyQuizRun.updateMany = async () => ({ count: 1 });
db.dailyQuizRun.update = async ({ data }) => data;
db.dailyQuizRun.deleteMany = async () => { released++; return { count: 1 }; };
db.generatedPoll.count = db.randomPoll.count = async () => 0;
db.generatedPoll.findMany = db.randomPoll.findMany = async () => [];
db.randomPoll.findFirst = async () => null;
db.randomPoll.create = async ({ data }) => data;
db.generatedPoll.create = async ({ data }) => { generated = data; return data; };
db.quizSettlement.create = async ({ data }) => data;
db.$transaction = async work => work(db);
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  aiCalls++; onGenerate();
  const question = { language: "pl", topic: "Test", question: `Pytanie ${aiCalls}?`, options: ["A", "B"],
    optionEmojis: ["", ""], topicEmoji: "", correctOption: 0, explanation: "Fakt." };
  return new Response(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message",
    content: [{ type: "output_text", text: JSON.stringify(question) }] }] }), { headers: { "content-type": "application/json" } });
};
const channels = new Map();
const { handleTopic } = await import("../dist/commands/topic.js");
const { publishTopicQuestions, publishRandomQuestion, TopicChannelChangedError } = await import("../dist/services/poll-publisher.js");
const { runDueTopics } = await import("../dist/scheduler.js");
const { routeCommand } = await import("../dist/commands/dilemma.js");
function makeChannel(id, type = ChannelType.GuildText, guildId = "guild") {
  const channel = { id, type, guildId, permitted: true, isSendable: () => true,
    permissionsFor: () => new PermissionsBitField(channel.permitted ? PermissionsBitField.All : PermissionFlagsBits.ViewChannel),
    send: async payload => {
      sends++;
      return { id: `poll-${sends}`, channelId: id, poll: { allowMultiselect: false, expiresAt: new Date(Date.now() + 7200000),
        answers: new Map(quizAnswers(payload).map((answer, i) => [7 + i * 3, { id: 7 + i * 3, text: answer.text }])) } };
    } };
  channels.set(id, channel); return channel;
}
const first = makeChannel("first"), second = makeChannel("second", ChannelType.GuildAnnouncement), adminChannel = makeChannel("admin");
makeChannel("voice", ChannelType.GuildVoice); makeChannel("thread", ChannelType.PublicThread);
makeChannel("category", ChannelType.GuildCategory); makeChannel("foreign", ChannelType.GuildText, "other");
function request(action, values = {}, { manager = true, permission = 0n, guildId = "guild", current = adminChannel } = {}) {
  const replies = [];
  return { user: { id: "actor" }, replies, guildId, channelId: current.id, channel: current, locale: "pl", member: { roles: manager ? ["manager"] : [] },
    memberPermissions: new PermissionsBitField(permission), guild: { id: guildId, members: { me: { id: "bot" } },
      channels: { fetch: async id => { fetches++; return channels.get(id) ?? null; } } },
    options: { getSubcommand: () => action, getRole: name => values[name] ?? null, getBoolean: name => values[name] ?? null, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null,
      getChannel: name => values[name] ?? null },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload.content);
      lastFeedback = ["aiInvalidResponse", "generationFailed", "randomCooldown", "randomDailyLimit", "aiConfiguration", "aiUnavailable", "randomChannelOnly", "optionCountInvalid", "durationInvalid", "optionsMismatch", "optionsInvalid"].find(key => message("pl", key) === payload.content) ?? null; },
    followUp: async payload => { assert.equal(payload.flags, MessageFlags.Ephemeral); replies.push(payload.content); } };
}
async function invoke(handler, action, values, options) { const item = request(action, values, options); await handler(item); return item.replies.at(-1); }
const snapshot = () => ({ claims, aiCalls, sends });
try {
  for (const action of ["add", "remove", "list"]) {
    const before = { writes, fetches };
    assert.equal(await invoke(handleChannels, action, { channel: first }, { manager: false }), message("pl", "permission"));
    assert.deepEqual({ writes, fetches }, before);
  }
  assert.equal(await invoke(handleChannels, "list", {}), message("pl", "quizChannelsEmpty"));
  const healthyLookup = db.quizChannel.findFirst;
  db.quizChannel.findFirst = async () => { throw new Error("Fixture unavailable database"); };
  const unavailable = snapshot();
  await assert.rejects(invoke(handleTopic, "random", { option_count: 2 }, { manager: false, current: first }), /Fixture unavailable database/);
  assert.deepEqual(snapshot(), unavailable, "Database errors cannot be mistaken for an empty list");
  db.quizChannel.findFirst = healthyLookup;
  for (const permission of [0n, PermissionFlagsBits.Administrator]) {
    const before = snapshot();
    assert.ok((await invoke(handleTopic, "random", { option_count: 2 }, { manager: false, permission, current: first })).includes("Quiz gotowy"));
    assert.equal(sends, before.sends + 1);
    assert.equal(aiCalls, before.aiCalls + 1);
  }
  for (const id of ["voice", "thread", "category", "foreign", "deleted"]) {
    const count = assigned.size;
    assert.equal(await invoke(handleChannels, "add", { channel: channels.get(id) ?? { id } }), message("pl", "quizChannelInvalid"));
    assert.equal(assigned.size, count);
  }
  first.permitted = false;
  assert.equal(await invoke(handleChannels, "add", { channel: first }), message("pl", "quizChannelPermissions"));
  first.permitted = true;
  await Promise.all([invoke(handleChannels, "add", { channel: first }), invoke(handleChannels, "add", { channel: second })]);
  await invoke(handleChannels, "add", { channel: first }, { manager: false, permission: PermissionFlagsBits.ManageGuild });
  assert.equal(assigned.size, 2);
  const restricted = snapshot();
  for (const permission of [0n, PermissionFlagsBits.Administrator]) {
    assert.equal(await invoke(handleTopic, "random", {}, { manager: false, permission, current: adminChannel }), message("pl", "randomChannelOnly"));
  }
  assert.deepEqual(snapshot(), restricted);
  const listing = request("list", {});
  listing.commandName = "dilemma";
  listing.options.getSubcommandGroup = () => "random-channels";
  await routeCommand(listing);
  assert.ok(listing.replies[0].includes(message("pl", "quizChannelsTitle")));
  assert.ok(listing.replies.join("\n").includes("<#first>"));
  const originalAssign = db.quizChannel.upsert;
  db.quizChannel.upsert = async () => { throw new Prisma.PrismaClientKnownRequestError("Fixture duplicate", { code: "P2002", clientVersion: "test" }); };
  assert.equal(await invoke(handleChannels, "add", { channel: first }), message("pl", "quizChannelAdded", { channel: "<#first>" }));
  await assert.rejects(invoke(handleChannels, "add", { channel: adminChannel }), error => error.code === "P2002");
  db.quizChannel.upsert = originalAssign;
  assert.ok((await invoke(handleChannels, "list", {})).includes("<#second>"));
  assert.equal(await canUseRandomQuizChannel("other", first.id), true, "An unrestricted server does not inherit another server's list");
  assigned.set("other:foreign", { guildId: "other", channelId: "foreign" });
  const foreignBefore = snapshot();
  assert.equal(await invoke(handleTopic, "random", {}, { manager: false, guildId: "other", current: first }), message("pl", "randomChannelOnly"));
  assert.equal(await invoke(handleTopic, "random", {}, { manager: false, current: channels.get("thread") }), message("pl", "randomChannelOnly"));
  assert.deepEqual(snapshot(), foreignBefore);
  assigned.delete("other:foreign");
  assert.ok((await invoke(handleTopic, "random", { option_count: 2 }, { manager: false, current: first })).includes("Quiz gotowy"));
  await invoke(handleChannels, "remove", { channel: first });
  const removedBefore = snapshot();
  await assert.rejects(publishRandomQuestion("guild", 2, first), RandomQuizChannelError);
  assert.deepEqual(snapshot(), removedBefore);
  assert.ok(assigned.has("guild:second"));
  const during = { sends, released };
  onGenerate = () => {
    assigned.set("guild:first", { guildId: "guild", channelId: first.id });
    assigned.delete("guild:second");
  };
  await assert.rejects(publishRandomQuestion("guild", 2, second), RandomQuizChannelError);
  assert.equal(sends, during.sends); assert.equal(released, during.released + 2);
  onGenerate = () => {};
  assert.equal(await invoke(handleChannels, "remove", { channel: first }), message("pl", "randomChannelsUnrestricted", { channel: "<#first>" }));
  assert.equal(await invoke(handleChannels, "list", {}), message("pl", "quizChannelsEmpty"));
  assert.equal(await canUseRandomQuizChannel("guild", adminChannel.id), true);
  const restored = sends;
  assert.ok((await invoke(handleTopic, "random", { option_count: 2 }, { manager: false, current: adminChannel })).includes("Quiz gotowy"));
  assert.equal(sends, restored + 1);
  await invoke(handleChannels, "add", { channel: second });
  onGenerate = () => assigned.delete("guild:second");
  const clearedDuring = sends;
  await publishRandomQuestion("guild", 2, second);
  assert.equal(sends, clearedDuring + 1, "Clearing the final restriction during generation permits publication");
  onGenerate = () => assigned.set("guild:second", { guildId: "guild", channelId: second.id });
  const addedDuring = { sends, released };
  await assert.rejects(publishRandomQuestion("guild", 2, first), RandomQuizChannelError);
  assert.equal(sends, addedDuring.sends);
  assert.equal(released, addedDuring.released + 2, "New restrictions during unrestricted generation release unspent quota");
  onGenerate = () => {};
  assigned.clear();
  await invoke(handleChannels, "add", { channel: adminChannel });
  await invoke(handleTopic, "create", { name: "Science", channel: first, option_count: 2 });
  const topic = [...topics.values()][0];
  assert.equal(topic.channelId, first.id);
  assert.equal(assigned.size, 1, "Topic destinations do not change the independent random-channel list");
  assert.equal(await canUseRandomQuizChannel("guild", first.id), false);
  await invoke(handleTopic, "configure", { name: "Science", channel: second });
  assert.equal(topic.channelId, second.id);
  await invoke(handleTopic, "configure", { name: "Science", duration_hours: 3 });
  assert.equal(topic.channelId, second.id);
  assert.equal(await invoke(handleTopic, "configure", { name: "Science", channel: channels.get("foreign") }), message("pl", "quizChannelInvalid"));
  assert.equal(topic.channelId, second.id);
  const denied = snapshot();
  second.permitted = false;
  assert.equal(await invoke(handleTopic, "run", { name: "Science" }), message("pl", "quizChannelPermissions"));
  assert.deepEqual(snapshot(), denied);
  second.permitted = true;
  assert.ok((await invoke(handleTopic, "run", { name: "Science" })).includes("<#second>"));
  assert.equal(generated.channelId, second.id); assert.equal(topic.channelId, second.id);
  topic.lastGeneratedAt = null;
  topic.generationTime = "00:00";
  await runDueTopics({ channels: { fetch: async id => { assert.equal(id, second.id); return channels.get(id); } } });
  assert.equal(generated.channelId, second.id);
  topic.lastGeneratedAt = null;
  const changed = { sends, released };
  onGenerate = () => { topic.channelId = first.id; };
  await assert.rejects(publishTopicQuestions({ ...topic }, second), TopicChannelChangedError);
  assert.equal(sends, changed.sends); assert.equal(released, changed.released + 1);
  onGenerate = () => {};
  const currentTopic = { ...topic };
  const originalSend = first.send;
  first.send = async payload => { topic.channelId = second.id; return originalSend(payload); };
  await publishTopicQuestions(currentTopic, first);
  assert.equal(topic.channelId, second.id, "Publication never overwrites a newer saved destination");
  first.send = originalSend;
  topic.channelId = null; topic.lastGeneratedAt = null;
  const missingBefore = snapshot();
  assert.equal(await invoke(handleTopic, "run", { name: "Science" }), message("pl", "topicChannelMissing"));
  assert.deepEqual(snapshot(), missingBefore);
  const menu = channelsCommand.toJSON();
  assert.equal(menu.name, "random-channels");
  assert.deepEqual(menu.options.map(item => item.name), ["add", "remove", "list"]);
  for (const item of menu.options.slice(0, 2)) assert.deepEqual(item.options[0].channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  console.log(JSON.stringify({ check: "quiz-channels", passed: true, guildIsolation: true, delegatedManagement: true,
    randomRestrictions: true, savedDestinations: true, scheduledDestination: true, revocationDuringGeneration: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "quiz-channels", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    feedback: lastFeedback, counts: snapshot(),
    line: Number(error.stack?.match(/test-quiz-channels\.mjs:(\d+)/)?.[1] ?? 0) })); process.exitCode = 1;
} finally { globalThis.fetch = realFetch; await db.$disconnect(); }
