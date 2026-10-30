import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { achievements, achievementProgress, achievementRequirement, badgeOptionNames, decodeSelectedBadges, encodeSelectedBadges, maxDisplayedBadges, selectedAchievements } = await import("../dist/services/achievements.js");
const { achievementIcon } = await import("../dist/services/achievement-icons.js");
const { scoreCardSvg, renderScoreCard } = await import("../dist/services/score-card.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { db } = await import("../dist/db.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const { routeCommand, routeAutocomplete, dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const zero = { points: 0, answered: 0, correct: 0, currentStreak: 0, bestStreak: 0, selectedBadge: null };
assert.equal(achievements.length, 6);
assert.equal(new Set(achievements.map(item => item.id)).size, achievements.length);
assert.ok(achievementProgress(null).every(item => !item.unlocked));
const earned = { ...zero, points: 10, answered: 100, correct: 10, bestStreak: 10, selectedBadge: "streak_10" };
assert.equal(achievementProgress(earned).filter(item => item.unlocked).length, 5);
assert.equal(maxDisplayedBadges, 3);
assert.deepEqual(selectedAchievements(earned).map(item => item.id), ["streak_10"]);
assert.deepEqual(selectedAchievements({ ...earned, selectedBadge: "level_5" }), []);
assert.deepEqual(selectedAchievements({ ...earned, selectedBadge: "unknown" }), []);
const threeIds = ["streak_10", "correct_10", "first_answer"];
assert.equal(encodeSelectedBadges([]), null);
assert.equal(encodeSelectedBadges(["first_answer"]), "first_answer");
assert.deepEqual(decodeSelectedBadges(encodeSelectedBadges(threeIds)), threeIds);
assert.deepEqual(selectedAchievements({ ...earned, selectedBadge: encodeSelectedBadges(threeIds) }).map(item => item.id), threeIds);
for (const invalid of [null, "", "[", "{}", '"first_answer"', "x".repeat(257), '[{},null,1,"unknown"]']) {
  assert.deepEqual(decodeSelectedBadges(invalid), []);
}
assert.deepEqual(decodeSelectedBadges('["first_answer","first_answer","unknown","correct_10"]'), ["first_answer", "correct_10"]);
assert.deepEqual(decodeSelectedBadges(JSON.stringify(achievements.map(item => item.id))), achievements.slice(0, 3).map(item => item.id));
assert.deepEqual(selectedAchievements({ ...earned, selectedBadge: '["level_5","first_answer"]' }).map(item => item.id), ["first_answer"]);
for (const invalid of [["unknown"], ["first_answer", "first_answer"], achievements.slice(0, 4).map(item => item.id)]) {
  assert.throws(() => encodeSelectedBadges(invalid), RangeError);
}
assert.equal(new Set(achievements.map(item => achievementIcon(item.id))).size, 6, "Every badge has its own icon");
assert.equal(achievementIcon("unknown"), "");
for (const achievement of achievements) {
  const field = achievement.metric === "level" ? "points" : achievement.metric;
  const threshold = achievement.metric === "level" ? achievementRequirement(achievement.id).points.gte : achievement.target;
  assert.equal(achievementProgress({ ...zero, [field]: threshold - 1 }).find(item => item.id === achievement.id).unlocked, false);
  const reached = achievementProgress({ ...zero, [field]: threshold }).find(item => item.id === achievement.id);
  assert.equal(reached.unlocked, true);
  assert.equal(reached.current, achievement.target);
}
assert.equal(achievementRequirement("unknown"), null);

const players = new Map();
const key = (guild, user) => `${guild}:${user}`;
const put = (guild, user, score) => players.set(key(guild, user), { guildId: guild, userId: user, ...score });
put("guild", "player", earned);
put("other-guild", "player", { ...earned, points: 100, selectedBadge: "level_5" });
let locale = "pl", updates = 0, queries = 0;
db.guildSettings.findUnique = async ({ where }) => { assert.ok(where.guildId); return { language: locale }; };
db.userScore.findUnique = async ({ where }) => { queries++; const { guildId, userId } = where.guildId_userId; return players.get(key(guildId, userId)) ?? null; };
db.userScore.count = async () => 0;
db.userScore.updateMany = async ({ where, data }) => {
  updates++;
  const player = players.get(key(where.guildId, where.userId));
  const matches = filter => Object.entries(filter).every(([field, condition]) => {
    if (field === "AND") return condition.every(matches);
    return condition && typeof condition === "object" ? player[field] >= condition.gte : player[field] === condition;
  });
  if (!player || !matches(where)) return { count: 0 };
  assert.deepEqual(Object.keys(data), ["selectedBadge"], "Badge selection never modifies score or EXP");
  Object.assign(player, data);
  return { count: 1 };
};
db.userScore.deleteMany = async ({ where }) => ({ count: Number(players.delete(key(where.guildId, where.userId))) });
db.quizAnswer.deleteMany = async ({ where }) => { assert.equal(where.guildId, "guild"); assert.equal(where.userId, "player"); return { count: 0 }; };
db.quizVote.deleteMany = db.quizSupport.deleteMany = db.quizWager.deleteMany = async ({where}) => {
  assert.equal(where.guildId,"guild"); assert.equal(where.userId,"player"); return {count:0};
};
db.$transaction = async callback => callback(db);
function interaction(sub, values = {}, guildId = "guild", userId = "player") {
  const replies = [];
  return { commandName: "dilemma", guildId, locale: "en-US", user: { id: userId, displayName: "Test" },
    options: { getSubcommandGroup: () => "score", getSubcommand: () => sub, getUser: () => values.user ?? null,
      getString: name => values[name] ?? null, getBoolean: name => values[name] ?? false,
      getFocused: () => ({ name: values.focus ?? "achievement", value: values.search ?? "" }) },
    deferReply: async options => assert.equal(options.flags, 64),
    editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload); },
    respond: async choices => replies.push(choices), replies };
}
const group = dilemmaCommand.toJSON().options.find(option => option.name === "score");
assert.equal(group.options.find(option => option.name === "badge").options[0].autocomplete, true);
assert.equal(group.options.find(option => option.name === "badge").options[0].required, true);
const badgeOptions = group.options.find(option => option.name === "badge").options;
assert.deepEqual(badgeOptions.map(option => option.name), [...badgeOptionNames]);
assert.ok(badgeOptions.every(option => option.autocomplete && option.max_length === 32));
assert.ok(badgeOptions.slice(1).every(option => !option.required));
for (const language of messageLanguages) {
  locale = language;
  clearGuildSettingsCache("guild");
  const command = interaction("achievements");
  await routeCommand(command);
  const embed = command.replies[0].embeds[0].toJSON();
  assert.equal(embed.fields.length, 6);
  assert.match(embed.description, /5\/6/);
  for (const achievement of achievements) {
    const field = embed.fields.find(field => field.name.includes(message(language, achievement.name)));
    assert.ok(field.value.includes(message(language, achievement.goal)));
    assert.ok(field.value.length < 1024);
  }
  assert.ok(embed.fields.find(field => field.name.includes(message(language, "achievementStreak10"))).value.includes(message(language, "achievementSelected")));
  const choices = interaction("badge");
  await routeAutocomplete(choices);
  assert.equal(choices.replies[0].length, 6);
  assert.ok(choices.replies[0].some(choice => choice.name === message(language, "badgeNone") && choice.value === "none"));
  assert.ok(!choices.replies[0].some(choice => choice.value === "level_5"));
  const card = { title: "Test", level: message(language, "scoreLevel", { level: 2 }), rank: 1,
    sparksLabel: message(language, "sparksName"), sparks: "42",
    points: message(language, "scorePoints", { points: 10 }).replace(/\*\*/g, ""), experience: "0 / 200 EXP", percent: 0,
    answersLabel: message(language, "scoreAnswers"), answers: "100", correctLabel: message(language, "scoreCorrect"), correct: "10 (10%)",
    streakLabel: message(language, "scoreStreak"), streak: "0 / 10",
    badges: threeIds.map(id => ({ id, name: message(language, achievements.find(item => item.id === id).name) })) };
  const svg = await scoreCardSvg(card);
  assert.equal((svg.match(/id="achievement-badge-\d"/g) ?? []).length, 3);
  for (const badge of card.badges) {
    assert.ok(svg.includes(`<title>${badge.name}</title>`));
    assert.ok(!svg.includes(`>${badge.name}</text>`), "Names stay in accessible text, not repeated on the PNG");
  }
  assert.ok(!/href="https?:\/\//.test(svg));
  const metadata = await sharp(await renderScoreCard(card)).metadata();
  assert.equal(metadata.width, 1120); assert.equal(metadata.height, 560);
  for (const count of [0, 1, 2, 3]) {
    const limited = await scoreCardSvg({ ...card, badges: card.badges.slice(0, count) });
    assert.equal((limited.match(/id="achievement-badge-\d"/g) ?? []).length, count);
  }
  assert.ok(!(await scoreCardSvg({ ...card, badges: undefined })).includes('id="achievement-badges"'));
  const injected = await scoreCardSvg({ ...card, badges: [{ id: "first_answer", name: '<script>test</script>' }, { id: '<image href="https://invalid"/>', name: "ignored" }] });
  assert.ok(!injected.includes('<script>') && !injected.includes('<image href="https://invalid"'));
  const excessive = await scoreCardSvg({ ...card, badges: achievements.map(item => ({ id: item.id, name: message(language, item.name) })) });
  assert.equal((excessive.match(/id="achievement-badge-\d"/g) ?? []).length, 3, "Renderer also enforces the limit");
  const repeated = await scoreCardSvg({ ...card, badges: [card.badges[0], card.badges[0]] });
  assert.equal((repeated.match(/id="achievement-badge-\d"/g) ?? []).length, 1);
  if (process.argv.includes("--preview") && language === "pl") {
    const directory = new URL("../.tools/score-card-preview/", import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL("three-badges.png", directory), await renderScoreCard(card));
    await writeFile(new URL("three-badges-long-name.png", directory), await renderScoreCard({ ...card, title: "Bardzo długi nick ".repeat(10), points: "1000000000 pkt", rank: 1000000 }));
  }
}
locale = "pl";
clearGuildSettingsCache("guild");
const filtered = interaction("badge", { search: "pierwszy" }); await routeAutocomplete(filtered);
assert.ok(filtered.replies[0].every(choice => /pierwszy/i.test(choice.name)));
const newcomer = interaction("badge", {}, "guild", "new"); await routeAutocomplete(newcomer);
assert.deepEqual(newcomer.replies[0].map(choice => choice.value), ["none"]);
for (const focus of badgeOptionNames) {
  const choices = interaction("badge", { focus, ...Object.fromEntries(badgeOptionNames.filter(name => name !== focus).map((name, i) => [name, threeIds[i]])) });
  await routeAutocomplete(choices);
  assert.ok(!choices.replies[0].some(choice => threeIds.slice(0, 2).includes(choice.value)), "Autocomplete excludes selections in other slots");
}
const beforeInvalid = updates;
const unknown = interaction("badge", { achievement: "invented" }); await routeCommand(unknown);
assert.equal(updates, beforeInvalid);
const locked = interaction("badge", { achievement: "level_5" }); await routeCommand(locked);
assert.equal(locked.replies[0].content, message("pl", "badgeLocked"));
assert.equal(players.get(key("guild", "player")).selectedBadge, "streak_10");
const select = interaction("badge", { achievement: "correct_10", user: { id: "someone-else" } }); await routeCommand(select);
assert.equal(players.get(key("guild", "player")).selectedBadge, "correct_10", "Only the caller's badge is changed");
assert.equal(players.get(key("other-guild", "player")).selectedBadge, "level_5", "Selections are server-specific");
const profile = interaction("profile"); await routeCommand(profile);
assert.ok(profile.replies[0].files[0].description.includes(message("pl", "scoreBadge", { badge: message("pl", "achievementCorrect10") })));
const originalPng = sharp.prototype.png;
try {
  sharp.prototype.png = function () { throw new Error("Synthetic render failure"); };
  const fallback = interaction("profile"); await routeCommand(fallback);
  assert.ok(fallback.replies[0].embeds[0].toJSON().fields.some(field => field.value === message("pl", "achievementCorrect10")));
} finally { sharp.prototype.png = originalPng; }
const unchangedStats = { ...players.get(key("guild", "player")), selectedBadge: undefined };
const multi = interaction("badge", { achievement: threeIds[0], achievement_2: threeIds[1], achievement_3: threeIds[2] });
await routeCommand(multi);
assert.deepEqual(decodeSelectedBadges(players.get(key("guild", "player")).selectedBadge), threeIds);
assert.deepEqual({ ...players.get(key("guild", "player")), selectedBadge: undefined }, unchangedStats);
const multipleProfile = interaction("profile"); await routeCommand(multipleProfile);
const selectedNames = threeIds.map(id => message("pl", achievements.find(item => item.id === id).name));
for (const name of selectedNames) assert.ok(multipleProfile.replies[0].files[0].description.includes(name));
const longNameProfile = interaction("profile");
longNameProfile.user.displayName = "Długi nick ".repeat(200);
await routeCommand(longNameProfile);
assert.ok(longNameProfile.replies[0].files[0].description.length <= 1000);
for (const name of selectedNames) assert.ok(longNameProfile.replies[0].files[0].description.includes(name), "Long nicknames leave room for all badge names in accessible text");
const marked = interaction("achievements"); await routeCommand(marked);
assert.equal(marked.replies[0].embeds[0].toJSON().fields.filter(field => field.value.includes(message("pl", "achievementSelected"))).length, 3);
try {
  sharp.prototype.png = function () { throw new Error("Synthetic render failure"); };
  const fallback = interaction("profile"); await routeCommand(fallback);
  assert.ok(fallback.replies[0].embeds[0].toJSON().fields.some(field => field.name === message("pl", "badgesSelected") && field.value === selectedNames.join(", ")));
} finally { sharp.prototype.png = originalPng; }
const savedSelection = players.get(key("guild", "player")).selectedBadge;
for (const values of [
  { achievement: "first_answer", achievement_2: "level_5" },
  { achievement: "first_answer", achievement_2: "correct_10", achievement_3: "level_5" }
]) {
  const command = interaction("badge", values); await routeCommand(command);
  assert.equal(command.replies[0].content, message("pl", "badgeLocked"));
  assert.equal(players.get(key("guild", "player")).selectedBadge, savedSelection, "All choices are validated atomically");
}
for (const values of [
  { achievement: "first_answer", achievement_2: "first_answer" },
  { achievement: "none", achievement_3: "first_answer" },
  { achievement: "first_answer", achievement_3: "invented" }
]) {
  const before = updates;
  const command = interaction("badge", values); await routeCommand(command);
  assert.equal(updates, before, "Invalid choices never write partial selections");
  assert.equal(players.get(key("guild", "player")).selectedBadge, savedSelection);
}
const reduce = interaction("badge", { achievement: "first_answer", achievement_2: "correct_10" }); await routeCommand(reduce);
assert.deepEqual(decodeSelectedBadges(players.get(key("guild", "player")).selectedBadge), ["first_answer", "correct_10"]);
const single = interaction("badge", { achievement: "first_answer", achievement_2: "none" }); await routeCommand(single);
assert.equal(players.get(key("guild", "player")).selectedBadge, "first_answer");
const hide = interaction("badge", { achievement: "none" }); await routeCommand(hide);
assert.equal(players.get(key("guild", "player")).selectedBadge, null);
assert.equal(achievementProgress(players.get(key("guild", "player"))).filter(item => item.unlocked).length, 5);

players.get(key("guild", "player")).selectedBadge = encodeSelectedBadges(threeIds);
db.quizSettlement.updateMany = async () => ({ count: 1 });
db.quizAnswer.create = async ({ data }) => data;
db.quizAnswer.findMany = async () => [{ points: 1, correct: true }];
db.userScore.upsert = async ({ where, create, update }) => {
  const id = key(where.guildId_userId.guildId, where.guildId_userId.userId);
  players.set(id, players.has(id) ? { ...players.get(id), ...update } : create);
};
await applyFinalVotes({ guildId: "guild", messageId: "quiz", correctAnswerId: 1, answerIds: "1,2", difficulty: "easy" }, [{ userId: "player", answerId: 1 }], new Date(0));
assert.equal(players.get(key("guild", "player")).selectedBadge, encodeSelectedBadges(threeIds));
assert.deepEqual(selectedAchievements(players.get(key("guild", "player"))).map(item => item.id), ["first_answer"], "Never display badges no longer earned after score recalculation");
const forget = interaction("forget", { confirm: true }); await routeCommand(forget);
assert.ok(!players.has(key("guild", "player")));
assert.equal(players.get(key("other-guild", "player")).selectedBadge, "level_5");
const afterForget = interaction("badge", { achievement: "first_answer" }); await routeCommand(afterForget);
assert.equal(afterForget.replies[0].content, message("pl", "badgeLocked"));
assert.ok(!players.has(key("guild", "player")), "Badge writes never recreate a forgotten score");
const beforeDm = queries;
const dm = interaction("achievements", {}, null); await routeCommand(dm);
assert.equal(queries, beforeDm);
const dmChoices = interaction("badge", {}, null); await routeAutocomplete(dmChoices);
assert.deepEqual(dmChoices.replies[0], []);
await db.$disconnect();
console.log("PASS: six-locale achievements, up to three distinct icons, legacy selection, atomic eligibility, autocomplete, guild isolation, scoring preservation, PNG/fallback and privacy deletion");
