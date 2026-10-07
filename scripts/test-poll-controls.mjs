import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { MessageFlags, PermissionFlagsBits } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { handlePoll, handleEndPollButton } = await import("../dist/commands/poll.js");
const { pollControls, END_QUIZ_BUTTON_ID } = await import("../dist/services/poll-controls.js");
const { runDueSettlements } = await import("../dist/services/scoring.js");
const { message, messageLanguages } = await import("../dist/messages.js");

for (const language of messageLanguages) {
  const button = pollControls(language)[0].toJSON().components[0];
  assert.equal(button.custom_id, END_QUIZ_BUTTON_ID);
  assert.equal(button.label, message(language, "endQuizButton"));
  assert.equal(button.disabled, false);
  assert.equal(pollControls(language, true)[0].toJSON().components[0].disabled, true);
}
let stored, discordMessage, ends, patches, results, settlementUpdates, denyClaim, failEnd, failPatch, gate;
let random = false, recorded = true;
function reset() {
  stored = { messageId: "poll", guildId: "guild", channelId: "channel", endedAt: null,
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
  denyClaim = failEnd = failPatch = false;
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
  send: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); results.push(payload.content); } };
db.guildSettings.findUnique = async () => ({ language: "pl" });
db.generatedPoll.findUnique = async () => recorded && !random ? stored : null;
db.randomPoll.findUnique = async () => recorded && random ? stored : null;
const claim = async ({ where, data }) => {
  assert.equal(where.guildId, "guild");
  assert.equal(where.endedAt, null);
  if (denyClaim || stored.endedAt) return { count: 0 };
  Object.assign(stored, data);
  return { count: 1 };
};
db.generatedPoll.updateMany = db.randomPoll.updateMany = claim;
db.quizSettlement.updateMany = async ({ where, data }) => {
  assert.equal(where.guildId, "guild");
  assert.equal(where.scoredAt, null);
  assert.ok(data.nextCheckAt);
  settlementUpdates++;
  return { count: 1 };
};
db.quizSettlement.findMany = async () => [];
// Daily quota is untouched by any closing path.
db.dailyQuizRun.deleteMany = async () => { throw new Error("Closing must not reset quota"); };
function interaction({ permitted = true, guildId = "guild", customId = END_QUIZ_BUTTON_ID } = {}) {
  const replies = [];
  let deferred = false;
  return { guildId, customId, locale: "en", channel, message: { id: "poll" }, client,
    memberPermissions: { has: permission => { assert.equal(permission, PermissionFlagsBits.ManageGuild); return permitted; } },
    options: { getString: () => "poll" },
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
  assert.equal(settlementUpdates, 1);
  assert.equal(patches, 1);
  await handleEndPollButton(interaction());
  await handlePoll(interaction());
  assert.equal(ends, 1);
  assert.equal(results.length, 1, "Repeated button and fallback command never duplicate results");
}
reset();
await handlePoll(interaction());
assert.equal(ends, 1, "Fallback command uses the same closing flow");
assert.equal(results.length, 1);
reset();
let release;
gate = new Promise(resolve => { release = resolve; });
const first = handleEndPollButton(interaction());
while (!ends) await new Promise(resolve => setImmediate(resolve));
const second = interaction();
await handlePoll(second);
assert.equal(ends, 1);
assert.match(second.replies.at(-1), /właśnie zamykany/);
release();
await first;
assert.equal(results.length, 1);
reset(); denyClaim = true;
await handleEndPollButton(interaction());
assert.equal(results.length, 0, "Database claim protects against another process publishing a duplicate result");
reset(); failEnd = true;
await handleEndPollButton(interaction());
assert.equal(stored.endedAt, null);
failEnd = false;
await handleEndPollButton(interaction());
assert.equal(results.length, 1, "Failed close releases the in-process lock for retry");
reset(); failPatch = true;
await handleEndPollButton(interaction());
assert.equal(results.length, 1, "UI edit failure does not block results or scoring");
reset();
discordMessage.poll.expiresTimestamp = Date.now() - 1;
await handleEndPollButton(interaction());
assert.equal(ends, 0, "Already expired Discord polls do not need another end request");
assert.equal(results.length, 1);

// Finalized automatic expiry disables the button and retains the existing scoring gate.
reset();
let finalized = false, scored = false;
const quiz = { messageId: "poll", guildId: "guild", channelId: "channel", answerIds: "1,2", correctAnswerId: 1, difficulty: "easy" };
db.quizSettlement.findMany = async () => scored ? [] : [quiz];
db.quizSettlement.updateMany = async () => ({ count: 1 });
db.$transaction = async callback => callback({ quizSettlement: { updateMany: async () => { scored = true; return { count: 1 }; } } });
client.rest.get = async route => route.includes("/answers/")
  ? { users: [] }
  : { id: "poll", channel_id: "channel", author: { id: "bot" },
    poll: { allow_multiselect: false, expiry: new Date(Date.now() - 1000).toISOString(),
      answers: [{ answer_id: 1 }, { answer_id: 2 }], results: { is_finalized: finalized, answer_counts: [] } } };
await runDueSettlements(client);
assert.equal(scored, false, "Do not score before Discord finalizes votes");
assert.equal(patches, 0);
finalized = true;
await runDueSettlements(client);
assert.equal(scored, true);
assert.equal(patches, 1);
await db.$disconnect();
console.log("PASS: localized poll buttons, private feedback, permissions, ownership, duplicate/concurrent closes, fallback and automatic expiry");
