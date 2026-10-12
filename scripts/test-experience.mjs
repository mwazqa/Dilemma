import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { experienceProgress, levelThreshold } = await import("../dist/services/experience.js");
const { scoreHistory } = await import("../dist/services/scoring.js");
const { handleScore } = await import("../dist/commands/score.js");
const { db } = await import("../dist/db.js");
const { message, messageLanguages } = await import("../dist/messages.js");

assert.deepEqual(experienceProgress(0), { level: 1, totalExp: 0, earned: 0, required: 100, remaining: 100, percent: 0 });
assert.deepEqual(experienceProgress(3), { level: 1, totalExp: 30, earned: 30, required: 100, remaining: 70, percent: 30 });
assert.deepEqual(experienceProgress(10), { level: 2, totalExp: 100, earned: 0, required: 200, remaining: 200, percent: 0 });
assert.equal(experienceProgress(9).level, 1);
assert.equal(experienceProgress(9).percent, 90);
assert.equal(experienceProgress(12).earned, 20, "Surplus EXP carries into the next level");
assert.equal(experienceProgress(30).level, 3);
assert.equal(experienceProgress(60).level, 4);
assert.equal(experienceProgress(2147483647).totalExp, 21474836470);
for (const level of [1, 2, 3, 4, 10, 100, 1000]) {
  const threshold = levelThreshold(level);
  assert.equal(experienceProgress(threshold / 10).level, level);
  assert.equal(experienceProgress(threshold / 10).percent, 0);
  if (level > 1) assert.equal(experienceProgress(threshold / 10 - 1).level, level - 1);
}
for (const points of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => experienceProgress(points));
for (const level of [0, -1, 1.1, NaN]) assert.throws(() => levelThreshold(level));
for (const points of [0, 1, 2, 3, 10, 100, 10000]) {
  const progress = experienceProgress(points);
  assert.ok(progress.percent >= 0 && progress.percent < 100);
  assert.ok(progress.earned >= 0 && progress.earned < progress.required);
}
const settled = scoreHistory([{ correct: true, points: 1 }, { correct: true, points: 2 },
  { correct: true, points: 3 }, { correct: false, points: 0 }]);
assert.equal(experienceProgress(settled.points).totalExp, 60, "Correct answers award 10/20/30 EXP; a wrong answer adds none");

let language = "pl", player;
db.guildSettings.findUnique = async () => ({ language });
let rankQueries = 0;
db.userScore.count = async ({ where }) => { assert.equal(where.guildId, "guild"); rankQueries++; return 2; };
db.userScore.findMany = async ({ where, take }) => {
  assert.equal(where.guildId, "guild");
  assert.deepEqual(where.answered, { gt: 0 });
  assert.equal(take, 10);
  return [{ userId: "player", points: 2, answered: 4, correct: 2, bestStreak: 1 }];
};
db.userScore.findUnique = async ({ where }) => {
  assert.equal(where.guildId_userId.guildId, "guild");
  return player;
};
function interaction() {
  const replies = [];
  return { guildId: "guild", locale: "en", user: { id: "player", displayName: "Test" },
    options: { getSubcommand: () => "profile", getUser: () => null },
    deferReply: async () => {}, editReply: async payload => {
      assert.deepEqual(payload.allowedMentions.parse, []);
      replies.push(payload);
    }, replies };
}
for (const locale of messageLanguages) {
  language = locale;
  player = { points: 3, answered: 1, correct: 1, currentStreak: 1, bestStreak: 1 };
  const command = interaction();
  await handleScore(command);
  const card = command.replies[0].files[0].description;
  assert.equal(card.split("\n")[0], "Test", "Use only the player name in all six locales");
  assert.ok(card.includes(message(locale, "scoreLevel", { level: 1 })));
  assert.ok(card.includes(message(locale, "scoreRank", { rank: 3 })));
  assert.ok(card.includes(message(locale, "scoreExpProgress", { earned: 30, required: 100 })));
  assert.ok(card.includes("(30%)"));
  assert.ok(card.includes(`${message(locale, "scoreCorrect")}: 1 (100%)`), "Perfect accuracy never fills the EXP bar");
  player = { ...player, points: 10, answered: 10, correct: 10 };
  const advanced = interaction();
  await handleScore(advanced);
  const levelCard = advanced.replies[0].files[0].description;
  assert.ok(levelCard.includes(message(locale, "scoreLevel", { level: 2 })));
  assert.ok(levelCard.includes(message(locale, "scoreExpProgress", { earned: 0, required: 200 })));
  assert.ok(levelCard.includes("(0%)"));
  player = null;
  const queriesBeforeEmpty = rankQueries;
  const empty = interaction();
  await handleScore(empty);
  const emptyCard = empty.replies[0].files[0].description;
  assert.ok(emptyCard.includes(message(locale, "scoreLevel", { level: 1 })));
  assert.ok(emptyCard.includes(`${message(locale, "scoreCorrect")}: 0 (0%)`));
  assert.ok(emptyCard.includes(message(locale, "scoreUnranked")));
  assert.equal(rankQueries, queriesBeforeEmpty, "New players are not ranked and need no count query");
  player = { points: 2, answered: 4, correct: 2, currentStreak: 0, bestStreak: 1 };
  const mixed = interaction();
  await handleScore(mixed);
  const mixedCard = mixed.replies[0].files[0].description;
  assert.ok(mixedCard.includes(`${message(locale, "scoreAnswers")}: 4`));
  assert.ok(mixedCard.includes(`${message(locale, "scoreCorrect")}: 2 (50%)`));
  assert.ok(!mixedCard.includes("2/4"), "The correct-answer statistic does not duplicate total answers");
  const leaderboard = interaction();
  leaderboard.options.getSubcommand = () => "leaderboard";
  await handleScore(leaderboard);
  const ranking = leaderboard.replies[0].embeds[0].toJSON().description;
  assert.ok(ranking.includes(`${message(locale, "scoreAnswers")}: 4`), "Leaderboard explicitly labels total answers in every language");
  assert.ok(ranking.includes(`${message(locale, "scoreCorrect")}: 2 (50%)`));
  assert.ok(!ranking.includes("2/4"), "Leaderboard statistics do not repeat the total answer count");
}
await db.$disconnect();
console.log("PASS: EXP awards, level thresholds, surplus, existing points, server isolation and six-locale cards separating accuracy from progress");
