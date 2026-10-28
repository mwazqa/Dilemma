import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { MessageFlags, PermissionFlagsBits } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { handlePoll, handleEndPollButton } = await import("../dist/commands/poll.js");
const { routeCommand } = await import("../dist/commands/dilemma.js");
const { pollControls, END_QUIZ_BUTTON_ID } = await import("../dist/services/poll-controls.js");
const { runDueSettlements } = await import("../dist/services/scoring.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");

assert.equal(pollControls("pl")[0].toJSON().components[0].label, "Zakończ quiz");

for (const language of messageLanguages) {
  const button = pollControls(language)[0].toJSON().components[0];
  assert.equal(button.custom_id, END_QUIZ_BUTTON_ID);
  assert.equal(button.label, message(language, "endQuizButton"));
  assert.equal(button.disabled, false);
  assert.equal(pollControls(language, true)[0].toJSON().components[0].disabled, true);
}
let stored, discordMessage, ends, patches, results, settlementUpdates, denyClaim, failEnd, failPatch, failSend, gate;
let random = false, recorded = true;
let managerRoleId = null;
function reset() {
  managerRoleId = null;
  clearGuildSettingsCache();
  stored = { messageId: "poll", guildId: "guild", channelId: "channel", creatorUserId: null, endedAt: null,
    closedAt: null, closedByUserId: null, closeSource: null,
    options: "Alpha||Beta", correctOption: 0, optionEmojis: "||", explanation: "Test fact." };
  discordMessage = { id: "poll", author: { id: "bot" }, poll: {
    expiresTimestamp: Date.now() + 3_600_000,
    end: async () => {
      ends++;
      if (failEnd) throw new Error("test close failure");
      if (gate) await gate;
      discordMessage.poll.expiresTimestamp = Date.now() - 1;
    }
  } };
  ends = patches = settlementUpdates = 0;
  results = [];
  denyClaim = failEnd = failPatch = failSend = false;
  gate = undefined;
  random = false; recorded = true;
}
const client = { user: { id: "bot" }, rest: { patch: async (_, { body }) => {
  patches++;
  if (failPatch) throw new Error("test UI failure");
  assert.equal(body.components[0].components[0].disabled, true);
  assert.deepEqual(body.allowed_mentions.parse, []);
  assert.ok(!("poll" in body), "Only controls are edited");
} } };
const channel = { id: "channel", isTextBased: () => true, isSendable: () => true,
  messages: { fetch: async id => { assert.equal(id, "poll"); return discordMessage; } },
  send: async payload => {
    assert.deepEqual(payload.allowedMentions.parse, []);
    if (failSend) throw new Error("Synthetic send failure");
    results.push(payload.content);
  } };
db.guildSettings.findUnique = async () => ({ guildId: "guild", language: "pl", managerRoleId });
db.generatedPoll.findUnique = async () => recorded && !random ? stored : null;
db.randomPoll.findUnique = async () => recorded && random ? stored : null;
const claim = async ({ where, data }) => {
  assert.equal(where.guildId, "guild");
  assert.equal(where.channelId, "channel");
  if (denyClaim || (where.endedAt === null && stored.endedAt) || (where.closedAt === null && stored.closedAt)) return { count: 0 };
  Object.assign(stored, data);
  return { count: 1 };
};
db.generatedPoll.updateMany = db.randomPoll.updateMany = claim;
db.$transaction = async work => {
  const before = { ...stored };
  try { return await work(db); } catch (error) { Object.assign(stored, before); throw error; }
};
db.quizSettlement.updateMany = async ({ where, data }) => {
  assert.equal(where.guildId, "guild");
  if (data.resultsPending === false) return { count: 1 };
  assert.equal(where.scoredAt, null);
  assert.ok(data.nextCheckAt);
  settlementUpdates++;
  return { count: 1 };
};
db.quizSettlement.findMany = async () => [];
db.quizSettlement.findUnique = async () => null;
db.dailyQuizRun.deleteMany = async () => { throw new Error("Closing must not reset quota"); };
function interaction({ permitted = true, guildId = "guild", customId = END_QUIZ_BUTTON_ID, roles = [], userId = "actor" } = {}) {
  const replies = [];
  let deferred = false;
  return { user: { id: userId }, commandName: "dilemma", guildId, customId, locale: "en", channel, message: { id: "poll" }, client, member: { roles },
    memberPermissions: { has: permission => { assert.equal(permission, PermissionFlagsBits.ManageGuild); return permitted; } },
    options: { getSubcommandGroup: () => "poll", getSubcommand: () => "end", getString: () => "poll" },
    deferReply: async payload => { assert.equal(payload.flags, MessageFlags.Ephemeral); deferred = true; },
    editReply: async payload => { assert.ok(deferred); assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload.content); },
    replies };
}
reset();
const denied = interaction({ permitted: false });
await handleEndPollButton(denied);
assert.equal(ends, 0);
assert.equal(results.length, 0);
assert.match(denied.replies.at(-1), /Zarządzanie serwerem/);
const dm = interaction({ guildId: null });
await handleEndPollButton(dm);
assert.equal(ends, 0);
reset();
await handleEndPollButton(interaction({ customId: "other:button" }));
assert.equal(ends, 0);
for (const useRandom of [false, true]) {
  for (const button of [false, true]) {
    reset(); random = useRandom; managerRoleId = "fixture-manager";
    const request = interaction({ permitted: false, roles: [managerRoleId] });
    if (button) await handleEndPollButton(request);
    else await routeCommand(request);
    assert.equal(ends, 1, "Delegated managers can close scheduled and random quizzes");
    assert.equal(results.length, 1);
    assert.equal(stored.closedByUserId, "actor");
    assert.equal(stored.closeSource, button ? "button" : "command");
    assert.ok(stored.closedAt);
    assert.match(results[0], /<@actor>/);
  }
}
reset(); managerRoleId = "fixture-manager";
for (const handler of [handleEndPollButton, routeCommand]) {
  reset(); random = true; stored.creatorUserId = "creator";
  await handler(interaction({ permitted: false, userId: "someone-else" }));
  assert.equal(ends, 0, "Other players cannot close someone else's random quiz");
  await handler(interaction({ permitted: false, userId: "creator" }));
  assert.equal(ends, 1, "The persisted creator can close their random quiz without a management role");
  assert.equal(results.length, 1);
  assert.equal(settlementUpdates, 1);
  assert.equal(stored.closedByUserId, "creator");
  await handler(interaction({ permitted: false, userId: "creator" }));
  assert.equal(ends, 1);
  assert.equal(results.length, 1);
  reset(); stored.creatorUserId = "creator";
  await handler(interaction({ permitted: false, userId: "creator" }));
  assert.equal(ends, 0, "Random ownership never grants access to scheduled quizzes");
  for (const property of ["guildId", "channelId", "author", "poll"]) {
    reset(); random = true; stored.creatorUserId = "creator";
    if (property === "guildId") stored.guildId = "other";
    if (property === "channelId") stored.channelId = "other";
    if (property === "author") discordMessage.author.id = "other";
    if (property === "poll") discordMessage.poll = null;
    await handler(interaction({ permitted: false, userId: "creator" }));
    assert.equal(ends, 0, "Creator access still checks server, channel and bot poll ownership");
    assert.equal(results.length, 0);
    assert.equal(settlementUpdates, 0);
  }
}
reset(); managerRoleId = "fixture-manager";
await handleEndPollButton(interaction({ permitted: false, roles: ["different-role"] }));
assert.equal(ends, 0);
await handleEndPollButton(interaction({ permitted: false, roles: [] }));
assert.equal(ends, 0, "A removed role cannot close a quiz");
for (const property of ["guildId", "channelId", "author", "recorded", "poll"]) {
  reset();
  if (property === "guildId") stored.guildId = "other";
  if (property === "channelId") stored.channelId = "other";
  if (property === "author") discordMessage.author.id = "other";
  if (property === "recorded") recorded = false;
  if (property === "poll") discordMessage.poll = null;
  await handleEndPollButton(interaction());
  assert.equal(ends, 0, property);
  assert.equal(results.length, 0, property);
}
for (const useRandom of [false, true]) {
  reset(); random = useRandom;
  const button = interaction();
  await handleEndPollButton(button);
  assert.equal(ends, 1);
  assert.equal(results.length, 1);
  assert.match(results[0], /Alpha/);
  assert.ok(stored.endedAt);
  assert.equal(stored.closedByUserId, "actor");
  assert.equal(stored.closeSource, "button");
  assert.equal(settlementUpdates, 1);
  assert.equal(patches, 1);
  await handleEndPollButton(interaction());
  await handlePoll(interaction({ userId: "later-manager" }));
  assert.equal(ends, 1);
  assert.equal(results.length, 1, "Repeated button and fallback command never duplicate results");
  assert.equal(stored.closedByUserId, "actor", "Repeated requests preserve the original actor");
}
reset();
await routeCommand(interaction());
assert.equal(ends, 1, "Fallback command uses the same closing flow");
assert.equal(results.length, 1);
reset();
const deniedCommand = interaction({ permitted: false });
await routeCommand(deniedCommand);
assert.equal(ends, 0, "Nested poll command preserves the administrative permission check");
assert.match(deniedCommand.replies.at(-1), /Zarządzanie serwerem/);
for (const useRandom of [false, true]) {
  for (const handler of [handleEndPollButton, routeCommand]) {
    reset(); random = useRandom;
    const request = interaction({ permitted: false });
    await handler(request);
    assert.equal(ends, 0);
    assert.equal(results.length, 0);
    assert.equal(settlementUpdates, 0);
    assert.equal(patches, 0);
    assert.equal(request.replies.at(-1), message("pl", "permission"));
  }
}
reset();
let release;
gate = new Promise(resolve => { release = resolve; });
const first = handleEndPollButton(interaction());
while (!ends) await new Promise(resolve => setImmediate(resolve));
const second = interaction({ userId: "second-actor" });
await handlePoll(second);
assert.equal(ends, 1);
assert.equal(second.replies.at(-1), message("pl", "pollClosing"));
release();
await first;
assert.equal(results.length, 1);
assert.equal(stored.closedByUserId, "actor", "Concurrent controls preserve the successful actor");
reset(); denyClaim = true;
await handleEndPollButton(interaction());
assert.equal(results.length, 0, "Database claim protects against another process publishing a duplicate result");
reset(); failEnd = true;
await handleEndPollButton(interaction());
assert.equal(stored.endedAt, null);
assert.equal(stored.closedByUserId, null, "Failed end requests do not name an actor");
assert.equal(stored.closeSource, null);
assert.equal(stored.closedAt, null);
failEnd = false;
await handleEndPollButton(interaction());
assert.equal(results.length, 1, "Failed close releases the in-process lock for retry");
reset(); failPatch = true;
await handleEndPollButton(interaction());
assert.equal(results.length, 1, "UI edit failure does not block results or scoring");
reset(); failSend = true;
await handleEndPollButton(interaction());
assert.equal(stored.endedAt, null);
assert.equal(stored.closedByUserId, "actor", "Result delivery failure preserves the confirmed closure");
assert.equal(stored.closeSource, "button");
const closedAt = +stored.closedAt;
failSend = false;
await handlePoll(interaction({ userId: "retry-actor" }));
assert.equal(ends, 1);
assert.equal(stored.closedByUserId, "actor");
assert.equal(+stored.closedAt, closedAt);
assert.match(results[0], /<@actor>/);
assert.doesNotMatch(results[0], /retry-actor/);
reset();
discordMessage.poll.expiresTimestamp = Date.now() - 1;
await handleEndPollButton(interaction());
assert.equal(ends, 0, "Already expired Discord polls do not need another end request");
assert.equal(results.length, 1);
assert.equal(stored.closedByUserId, null, "Clicking an already expired poll never claims its closure");
assert.equal(stored.closeSource, "unknown");

reset();
let finalized = false, scored = false;
const quiz = { messageId: "poll", guildId: "guild", channelId: "channel", answerIds: "1,2", correctAnswerId: 1, difficulty: "easy",
  expiresAt: new Date(Date.now() - 1000), closedAt: null, scoredAt: null };
db.quizSettlement.findMany = async () => scored ? [] : [quiz];
db.quizSettlement.updateMany = async () => ({ count: 1 });
db.$transaction = async callback => callback({ generatedPoll: db.generatedPoll, randomPoll: db.randomPoll,
  quizSettlement: { findUnique: async () => ({ ...quiz }),
    updateMany: async ({ data }) => { Object.assign(quiz, data); if (data.scoredAt) scored = true; return { count: 1 }; } } });
client.rest.post = async (_, { body }) => { results.push(body.content); return { id: "result" }; };
client.rest.get = async route => route.includes("/answers/")
  ? { users: [] }
  : { id: "poll", channel_id: "channel", author: { id: "bot" },
    poll: { allow_multiselect: false, expiry: quiz.expiresAt.toISOString(),
      answers: [{ answer_id: 1 }, { answer_id: 2 }], results: { is_finalized: finalized, answer_counts: [] } } };
await runDueSettlements(client);
assert.equal(scored, false, "Do not score before Discord finalizes votes");
assert.equal(patches, 0);
finalized = true;
await runDueSettlements(client);
assert.equal(scored, true);
assert.equal(patches, 1);
assert.equal(results.length, 1);
assert.equal(stored.closeSource, "automatic");
await db.$disconnect();
console.log("PASS: localized poll buttons, private feedback, permissions, ownership, duplicate/concurrent closes, fallback and automatic expiry");
