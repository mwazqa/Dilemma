import assert from "node:assert/strict";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { MessageFlags } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { topicListView, handleTopicListComponent } = await import("../dist/commands/topic-list.js");
const { handleTopic } = await import("../dist/commands/topic.js");
const { cacheGuildSettings } = await import("../dist/services/guild-settings.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const owner = "100000000000000001", otherUser = "100000000000000002", bot = "100000000000000003";
const guildId = "100000000000000004", channelA = "100000000000000005", channelB = "100000000000000006";
const managerRoleId = "100000000000000007";
const initial = { owner, status: "all", difficulty: "all", channel: "all", page: 0 };
const settings = { guildId, language: "pl", timezone: "Europe/Warsaw", managerRoleId };
const fixture = (id, name, startDate, extra = {}) => ({ id, guildId, name, startDate, enabled: true,
  channelId: channelA, generationTime: "18:30", intervalDays: 7, pollDurationHours: 15, difficulty: "medium", optionCount: 4,
  createdAt: new Date("2026-10-25T10:00:00Z"), ...extra });
let topics = [
  fixture("late", "A później", "2026-11-09", { createdAt: new Date("2020-01-01T00:00:00Z") }),
  fixture("b", "B", "2026-11-01", { generationTime: "08:00" }),
  fixture("no-date", "Bez daty", null),
  fixture("disabled", "A", "2026-11-01", { enabled: false, difficulty: "hard", channelId: channelB }),
  fixture("early", "Z wcześniej", "2026-10-26", { lastGeneratedAt: new Date("2030-01-01T00:00:00Z") }),
  fixture("easy", "Łatwy", "2026-11-01", { difficulty: "easy" }),
  fixture("other-guild", "Foreign", "2000-01-01", { guildId: "other" })
];
let reads = 0, writes = 0, networks = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { networks++; throw new Error("Unexpected network request"); };
db.topic.findMany = async ({ where, select }) => {
  reads++;
  assert.equal(where.guildId, guildId);
  assert.deepEqual(Object.keys(select).sort(), ["id", "name", "enabled", "channelId", "startDate", "generationTime",
    "intervalDays", "pollDurationHours", "difficulty", "optionCount", "pingRoleId"].sort());
  return topics.filter(topic => topic.guildId === where.guildId).map(topic =>
    Object.fromEntries(Object.keys(select).map(key => [key, topic[key]])));
};
for (const operation of ["create", "update", "updateMany", "delete", "deleteMany"]) {
  db.topic[operation] = async () => { writes++; throw new Error("List must not change topics"); };
}
cacheGuildSettings(settings);
const embed = payload => payload.embeds[0].toJSON();
const fields = payload => embed(payload).fields ?? [];
const controls = payload => payload.components.flatMap(row => row.toJSON().components);
const control = (payload, action) => controls(payload).find(item => item.custom_id.endsWith(`:${action}`));
function component(payload, action, values = [], overrides = {}) {
  const replies = [], updates = [], followUps = [];
  const kind = action === "status" || action === "difficulty" ? "string" : action === "channel" ? "channel" : "button";
  return { customId: control(payload, action).custom_id, user: { id: owner }, guildId, locale: "pl",
    client: { user: { id: bot } }, message: { author: { id: bot } }, values,
    memberPermissions: { has: () => true }, member: { roles: [] },
    isStringSelectMenu: () => kind === "string", isChannelSelectMenu: () => kind === "channel", isButton: () => kind === "button",
    deferUpdate: async () => {}, editReply: async result => updates.push(result),
    reply: async result => replies.push(result), followUp: async result => followUps.push(result),
    replies, updates, followUps, ...overrides };
}
async function click(payload, action, values = [], overrides = {}) {
  const interaction = component(payload, action, values, overrides);
  await handleTopicListComponent(interaction);
  return interaction;
}

try {
  const ownTopics = topics.filter(topic => topic.guildId === guildId);
  let view = topicListView(ownTopics, initial, "pl", settings.timezone);
  assert.deepEqual(fields(view).map(field => field.name), ["2026-10-26 | Z wcześniej", "2026-11-01 | A",
    "2026-11-01 | B", "2026-11-01 | Łatwy", "2026-11-09 | A później"]);
  assert.ok(fields(view)[1].value.includes(message("pl", "disabled")));
  assert.ok(control(view, "previous").disabled && !control(view, "next").disabled);
  const next = await click(view, "next");
  view = next.updates[0];
  assert.deepEqual(fields(view).map(field => field.name), ["Bez daty startu | Bez daty"]);
  assert.ok(!control(view, "previous").disabled && control(view, "next").disabled);
  view = (await click(view, "previous")).updates[0];
  assert.equal(fields(view)[0].name, "2026-10-26 | Z wcześniej");
  view = (await click(view, "status", ["disabled"])).updates[0];
  assert.deepEqual(fields(view).map(field => field.name), ["2026-11-01 | A"]);
  view = (await click(view, "difficulty", ["hard"])).updates[0];
  view = (await click(view, "channel", [channelB])).updates[0];
  assert.equal(fields(view).length, 1);
  assert.equal(control(view, "channel").default_values[0].id, channelB);
  view = (await click(view, "channel", [channelA])).updates[0];
  assert.equal(embed(view).description, message("pl", "topicListNoMatches"));
  assert.equal(fields(view).length, 0);
  assert.ok(!control(view, "reset").disabled);
  view = (await click(view, "reset")).updates[0];
  assert.equal(fields(view).length, 5);
  assert.ok(control(view, "reset").disabled);
  view = (await click(view, "channel", [channelB])).updates[0];
  view = (await click(view, "channel", [])).updates[0];
  assert.equal(fields(view).length, 5);
  assert.ok(!control(view, "channel").default_values?.length);

  const countBeforeDenied = reads;
  for (const overrides of [{ user: { id: otherUser } }, { guildId: null },
    { message: { author: { id: otherUser } } }, { customId: "topic-list:broken" }]) {
    const denied = await click(view, "refresh", [], overrides);
    assert.equal(denied.updates.length, 0);
    assert.equal(denied.replies[0].flags, MessageFlags.Ephemeral);
  }
  assert.equal(reads, countBeforeDenied);
  const revoked = await click(view, "refresh", [], { memberPermissions: { has: () => false } });
  assert.equal(revoked.updates[0].content, message("pl", "permission"));
  assert.deepEqual(revoked.updates[0].components, []);
  assert.equal(reads, countBeforeDenied);
  const manager = await click(view, "refresh", [], { memberPermissions: { has: () => false }, member: { roles: [managerRoleId] } });
  assert.equal(fields(manager.updates[0]).length, 5);
  for (const [action, values, overrides] of [["status", ["bogus"], {}], ["difficulty", ["easy", "hard"], {}],
    ["channel", ["invalid"], {}], ["status", ["all"], { isStringSelectMenu: () => false }],
    ["next", [], { isButton: () => false }]]) {
    const before = reads;
    const invalid = await click(view, action, values, overrides);
    assert.equal(invalid.updates.length, 0);
    assert.equal(invalid.followUps[0].flags, MessageFlags.Ephemeral);
    assert.equal(reads, before);
  }
  const lastPage = (await click(view, "next")).updates[0];
  topics = [fixture("changed", "Zmieniony", "2027-01-01")];
  view = (await click(lastPage, "refresh")).updates[0];
  assert.deepEqual(fields(view).map(field => field.name), ["2027-01-01 | Zmieniony"]);
  assert.ok(control(view, "previous").disabled && control(view, "next").disabled);
  topics = [];
  view = (await click(view, "refresh")).updates[0];
  assert.equal(embed(view).description, message("pl", "emptyTopics"));
  const commandReplies = [];
  await handleTopic({ user: { id: owner }, guildId, locale: "en-US", memberPermissions: { has: () => true },
    options: { getSubcommand: () => "list" }, deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => commandReplies.push(payload) });
  assert.equal(embed(commandReplies[0]).title, message("pl", "topicListTitle"));
  assert.deepEqual(commandReplies[0].allowedMentions.parse, []);

  const large = Array.from({ length: 107 }, (_, index) => fixture(`large-${index}`, `Quiz ${index + 1}`, "2026-11-01"));
  const listed = [];
  for (let page = 0; page < 22; page++) listed.push(...fields(topicListView(large, { ...initial, page }, "pl", settings.timezone)).map(field => field.name));
  assert.equal(listed.length, 107);
  assert.equal(new Set(listed).size, 107);
  assert.equal(listed[1], "2026-11-01 | Quiz 2");
  assert.equal(listed[106], "2026-11-01 | Quiz 107");
  const longNames = Array.from({ length: 5 }, (_, index) => fixture(`long-${index}`, "*".repeat(78) + "🌸", null,
    { generationTime: null, channelId: null, difficulty: "hard" }));
  for (const language of messageLanguages) {
    for (const rows of [ownTopics, longNames, []]) {
      const payload = topicListView(rows, initial, language, settings.timezone), data = embed(payload);
      const totalLength = (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text.length ?? 0) +
        (data.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      assert.ok(totalLength <= 6000 && data.title.length <= 256 && data.description.length <= 4096);
      assert.ok((data.fields ?? []).every(field => field.name.length <= 256 && field.value.length <= 1024));
      assert.doesNotMatch(JSON.stringify(data), /\{\w+\}|<\/?(?:ul|ol|li)>/);
      assert.equal(payload.components.length, 4);
      assert.ok(controls(payload).every(item => item.custom_id.length <= 100));
      assert.ok(controls(payload).flatMap(item => item.options ?? []).every(option => option.label.length <= 100));
      assert.deepEqual(payload.allowedMentions.parse, []);
    }
  }
  assert.equal(writes, 0); assert.equal(networks, 0);
  console.log(JSON.stringify({ check: "topic-list", passed: true, locales: 6, completePagination: true,
    startDateOrder: true, filters: true, permissions: true, readOnly: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "topic-list", passed: false,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-topic-list\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  await db.$disconnect();
}
