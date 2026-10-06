import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { settlementData, scoreHistory, collectFinalVotes, applyFinalVotes, runDueSettlements } = await import("../dist/services/scoring.js");
const { db } = await import("../dist/db.js");
const { handleScore, scoreCommand } = await import("../dist/commands/score.js");
const { questionSchema } = await import("../dist/types/question.js");

assert.deepEqual(scoreHistory([{ correct: true, points: 1 }, { correct: true, points: 3 }, { correct: false, points: 0 }, { correct: true, points: 2 }]),
  { points: 6, answered: 4, correct: 3, currentStreak: 1, bestStreak: 2 });
assert.deepEqual(scoreHistory([]), { points: 0, answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 });
assert.equal(questionSchema.safeParse({ language: "pl", topic: "Test", question: "Q?", options: ["A", "B"], topicEmoji: "", optionEmojis: ["", ""], correctOption: 3, explanation: "Fact" }).success, false);

const metadata = settlementData({ id: "poll", channelId: "channel", poll: { allowMultiselect: false, expiresAt: new Date(0),
  answers: new Map([[93, { id: 93, text: "B" }], [17, { id: 17, text: "A" }]]) } }, "guild", "hard", ["A", "B"], 0);
assert.equal(metadata.correctAnswerId, 17, "Never assume answer ID equals option index + 1");
assert.equal(metadata.answerIds, "17,93");
assert.throws(() => settlementData({ poll: null }, "guild", "easy", ["A", "B"], 0));
const quiz = { ...metadata, scoredAt: null, closedAt: null, createdAt: new Date(), nextCheckAt: new Date(0) };
let finalized = false;
let expectedCount = 101;
let wrongOwner = false;
let duplicateAnswer = false;
const client = { user: { id: "bot" }, rest: { get: async (route, options) => {
  if (!route.includes("/answers/")) return { id: "poll", channel_id: "channel", author: { id: wrongOwner ? "other" : "bot" },
    poll: { allow_multiselect: false, expiry: new Date(0).toISOString(), answers: [{ answer_id: 17 }, { answer_id: 93 }],
      results: { is_finalized: finalized, answer_counts: [{ id: 17, count: expectedCount }, { id: 93, count: 1 }] } } };
  if (route.includes("/answers/93")) return { users: [{ id: duplicateAnswer ? "1" : "999", bot: false }] };
  const after = options.query.get("after");
  return { users: after ? [{ id: "101", bot: true }] : Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), bot: false })) };
} } };
assert.equal(await collectFinalVotes(client, quiz), null, "Do not score provisional votes");
finalized = true;
const final = await collectFinalVotes(client, quiz);
assert.equal(final.votes.length, 101, "Paginate past 100 voters and exclude bots");
assert.equal(final.votes.find(vote => vote.userId === "999").answerId, 93);
expectedCount = 102;
await assert.rejects(collectFinalVotes(client, quiz), /count mismatch/);
expectedCount = 101;
wrongOwner = true;
await assert.rejects(collectFinalVotes(client, quiz), /ownership/);
wrongOwner = false;
duplicateAnswer = true;
await assert.rejects(collectFinalVotes(client, quiz), /multiple answers/);
duplicateAnswer = false;

let claims = 0;
let answerRows = [];
let player;
db.$transaction = async cb => cb({ quizSettlement: { updateMany: async () => ({ count: claims++ === 0 ? 1 : 0 }) },
  quizAnswer: { create: async ({ data }) => { answerRows.push(data); return data; }, findMany: async () => answerRows },
  userScore: { upsert: async ({ create }) => player = create } });
assert.equal(await applyFinalVotes(quiz, [{ userId: "1", answerId: 17 }], new Date(0)), true);
assert.equal(player.points, 3);
assert.equal(player.currentStreak, 1);
assert.equal(await applyFinalVotes(quiz, [{ userId: "1", answerId: 17 }], new Date(0)), false);
assert.equal(answerRows.length, 1, "Duplicate settlement does not award twice");
await assert.rejects(applyFinalVotes(quiz, [{ userId: "1", answerId: 999 }], new Date(0)), /Invalid/);

db.guildSettings.findUnique = async () => ({ language: "pl" });
db.userScore.findUnique = async ({ where }) => { assert.equal(where.guildId_userId.guildId, "guild"); return player; };
db.userScore.findMany = async ({ where, orderBy, take }) => { assert.equal(where.guildId, "guild"); assert.equal(take, 10); assert.equal(orderBy[0].points, "desc"); return [player]; };
function interaction(sub, confirm = false, guildId = "guild") {
  const replies = [];
  return { guildId, locale: "en", user: { id: "1" }, options: { getSubcommand: () => sub, getUser: () => null, getBoolean: () => confirm },
    deferReply: async () => {}, editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload.content); }, replies };
}
const profile = interaction("profile"); await handleScore(profile); assert.match(profile.replies[0], /Punkty: \*\*3\*\*/);
const leaderboard = interaction("leaderboard"); await handleScore(leaderboard); assert.match(leaderboard.replies[0], /1\. <@1>/);
const dm = interaction("profile", false, null); await handleScore(dm); assert.match(dm.replies[0], /inside a server/);
let deletions = 0;
db.$transaction = async cb => cb({ quizAnswer: { deleteMany: async ({ where }) => { assert.deepEqual(where, { guildId: "guild", userId: "1" }); deletions++; } },
  userScore: { deleteMany: async () => { deletions++; } } });
await handleScore(interaction("forget")); assert.equal(deletions, 0);
const forgotten = interaction("forget", true); await handleScore(forgotten); assert.equal(deletions, 2); assert.match(forgotten.replies[0], /trwale usunięte/);
assert.deepEqual(scoreCommand.toJSON().options.map(sub => sub.name), ["profile", "leaderboard", "forget"]);
let checkUpdates = 0;
db.quizSettlement.findMany = async ({ where }) => { assert.ok(where.nextCheckAt); return [quiz]; };
db.quizSettlement.updateMany = async () => { checkUpdates++; };
finalized = false;
await runDueSettlements(client);
assert.equal(checkUpdates, 2, "Pending polls reschedule without blocking the queue");
await db.$disconnect();
console.log("PASS: score rules, answer ID mapping, pagination, finalized votes, bot filtering, idempotence, guild scope, privacy deletion and retry scheduling");
