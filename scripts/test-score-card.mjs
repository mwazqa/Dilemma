import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test" });
const { scoreCardSvg, renderScoreCard, fitText, graphemes, boundedText, escapeXml, allowedAvatarUrl, loadAvatar, cardFont } = await import("../dist/services/score-card.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { experienceProgress } = await import("../dist/services/experience.js");
const { handleScore } = await import("../dist/commands/score.js");
const { db } = await import("../dist/db.js");
const { serverRank } = await import("../dist/services/score-ranking.js");
function data(locale = "pl", name = "Mehow", points = 3) {
  const progress = experienceProgress(points);
  return { title: name,
    level: message(locale, "scoreLevel", { level: progress.level }),
    rank: 3,
    points: message(locale, "scorePoints", { points }).replace(/\*\*/g, ""),
    experience: message(locale, "scoreExpProgress", { earned: progress.earned, required: progress.required }),
    percent: progress.percent, answersLabel: message(locale, "scoreAnswers"), answers: "1",
    correctLabel: message(locale, "scoreCorrect"), correct: "1 (100%)",
    streakLabel: message(locale, "scoreStreak"), streak: "1 / 1" };
}
const svg = await scoreCardSvg(data());
assert.ok(svg.includes('width="302.4"'), "30% EXP occupies exactly 30% of the track");
assert.ok(svg.includes("1 (100%)"));
assert.ok(!svg.includes("1/1 (100%)"));
assert.ok(svg.includes("Odpowiedzi"));
assert.ok(svg.includes(">#3</text>"));
assert.ok(!svg.includes("w rankingu serwera"));
assert.ok(svg.includes(">Mehow</text>"));
assert.ok(!svg.includes("Karta quizowa") && !svg.includes("~ ♡"));
assert.ok(!svg.includes("Następny: poziom"));
assert.ok(svg.includes('id="rank-badge"'));
assert.ok(svg.includes('x="823" y="100"'), "Rank sits between the name and avatar, on the name baseline");
assert.ok(svg.includes('data-rank-tier="bronze"'));
for (const [rank, tier, color] of [[1, "gold", "#f2c879"], [2, "silver", "#d8e2f4"], [3, "bronze", "#dba477"], [4, "standard", "#aaa0ce"], [1000000, "standard", "#aaa0ce"], [null, "unranked", "#aaa0ce"]]) {
  const rankedSvg = await scoreCardSvg({ ...data(), rank });
  assert.ok(rankedSvg.includes(`data-rank-tier="${tier}"`));
  assert.ok(rankedSvg.includes(`fill="${color}"`));
  assert.equal(rankedSvg.includes('stroke-width="2.5"'), rank !== null && rank <= 3, "Only podium ranks receive the stronger outline");
  assert.ok(rankedSvg.includes(rank === null ? ">-</text>" : `>#${rank}</text>`));
}
assert.ok(!/href="https?:\/\//.test(svg), "No external resources in generated SVG");
assert.ok(escapeXml('<script>&"').includes("&lt;script&gt;&amp;&quot;"));
const injected = await scoreCardSvg({ ...data(), title: '<image href="https://example.invalid"/> & nick' });
assert.ok(injected.includes("&lt;image"));
assert.ok(!injected.includes('<image href="https://example.invalid"'));
assert.equal(graphemes("👨‍👩‍👧‍👦").length, 1);
assert.equal(boundedText("👨‍👩‍👧‍👦".repeat(100), 1000).length <= 1000, true);
assert.equal(boundedText("a👨‍👩‍👧‍👦b", 5), "a", "Never split emoji when bounding Discord text limits");
const longName = "👨‍👩‍👧‍👦 Zażółć gęślą jaźń ".repeat(20);
const long = await fitText(longName, 675);
assert.ok(long.text.endsWith("…"));
assert.ok(long.size >= 26);
const measured = await sharp({ text: { text: escapeXml(long.text), font: `${cardFont} Bold ${long.size}`, rgba: true } }).png().toBuffer({ resolveWithObject: true });
assert.ok(measured.info.width <= 675);
const longSvg = await scoreCardSvg(data("pl", longName));
assert.ok(longSvg.includes(`>${escapeXml(long.text)}</text>`), "The card uses the measured name width, leaving a gap before the rank badge");
const decoratedName = "Nick~ ♡ **test**";
assert.ok((await scoreCardSvg(data("pl", decoratedName))).includes(`>${decoratedName}</text>`), "Keep decorations that actually belong to the player's display name");
for (const locale of messageLanguages) {
  const localized = await scoreCardSvg(data(locale));
  assert.ok(localized.includes(">#3</text>"));
  assert.ok(localized.includes(">Mehow</text>"), "Every locale displays just the nickname");
  assert.ok(!localized.includes('y="250"'), "No next-level label above the progress bar");
  const png = await renderScoreCard(data(locale));
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1120);
  assert.equal(metadata.height, 560);
  assert.equal(metadata.exif, undefined);
  assert.ok(png.length < 1024 * 1024);
}
const zero = await scoreCardSvg(data("pl", "Mehow", 10));
assert.ok(!zero.includes("Następny: poziom"));
assert.ok(zero.includes('width="0" height="30"'));
assert.ok(!zero.includes('q 3 13 14 16'), "No misleading progress star at zero EXP");
for (const url of ["http://cdn.discordapp.com/embed/avatars/1.png", "https://evil.invalid/avatar.png", "https://cdn.discordapp.com.evil.invalid/embed/avatars/1.png",
  "https://user:pass@cdn.discordapp.com/embed/avatars/1.png", "https://cdn.discordapp.com:8443/embed/avatars/1.png", "https://cdn.discordapp.com/avatars/1/name.svg", "file:///avatar.png"]) {
  assert.equal(allowedAvatarUrl(url), false);
}
const avatarUrl = "https://cdn.discordapp.com/embed/avatars/1.png";
assert.equal(allowedAvatarUrl(avatarUrl), true);
assert.equal(allowedAvatarUrl("https://cdn.discordapp.com/avatars/123/a_abc123.png?size=128"), true);
const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async () => { fetches++; throw new Error("Private upstream failure"); };
assert.equal(await loadAvatar("https://evil.invalid/avatar.png"), undefined);
assert.equal(fetches, 0);
assert.equal(await loadAvatar(avatarUrl), undefined);
const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ad94f3" } }).png().toBuffer();
globalThis.fetch = async (_url, options) => { assert.equal(options.redirect, "error"); return new Response(image, { headers: { "content-type": "image/png" } }); };
const avatar = await loadAvatar(avatarUrl);
assert.equal((await sharp(avatar).metadata()).width, 144);
globalThis.fetch = async () => new Response(Buffer.alloc(1024 * 1024 + 1), { headers: { "content-type": "image/png" } });
assert.equal(await loadAvatar(avatarUrl), undefined);
globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/png" } });
assert.equal(await loadAvatar(avatarUrl), undefined, "Reject active input even if the server lies about MIME type");
globalThis.fetch = realFetch;
db.guildSettings.findUnique = async () => ({ language: "pl" });
const rows = [
  { guildId: "test", userId: "10", points: 3, correct: 1, answered: 1 },
  { guildId: "test", userId: "20", points: 3, correct: 1, answered: 1 },
  { guildId: "test", userId: "30", points: 3, correct: 2, answered: 2 },
  { guildId: "test", userId: "40", points: 6, correct: 1, answered: 1 },
  { guildId: "test", userId: "50", points: 0, correct: 0, answered: 1 },
  { guildId: "test", userId: "60", points: 99, correct: 99, answered: 0 },
  { guildId: "other", userId: "70", points: 99, correct: 99, answered: 99 }
];
let rankCalls = 0;
db.userScore.count = async ({ where }) => {
  rankCalls++;
  assert.equal(where.guildId, "test");
  assert.deepEqual(where.answered, { gt: 0 });
  const [points, correct, id] = where.OR;
  return rows.filter(row => row.guildId === where.guildId && row.answered > 0 && (
    row.points > points.points.gt ||
    (row.points === correct.points && row.correct > correct.correct.gt) ||
    (row.points === id.points && row.correct === id.correct && row.userId < id.userId.lt)
  )).length;
};
for (const row of rows.filter(row => row.guildId === "test" && row.answered > 0)) {
  const expected = [...rows].filter(item => item.guildId === "test" && item.answered > 0)
    .sort((a, b) => b.points - a.points || b.correct - a.correct || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  assert.equal(await serverRank("test", row.userId, row), expected.findIndex(item => item.userId === row.userId) + 1);
}
const beforeUnranked = rankCalls;
assert.equal(await serverRank("test", "new", null), null);
assert.equal(await serverRank("test", "new", { points: 0, correct: 0, answered: 0 }), null);
assert.equal(rankCalls, beforeUnranked);
db.userScore.count = async ({ where }) => { assert.equal(where.guildId, "test"); return 12; };
assert.equal(await serverRank("test", "1", { points: 3, correct: 1, answered: 1 }), 13);
db.userScore.findUnique = async () => ({ points: 3, answered: 1, correct: 1, currentStreak: 1, bestStreak: 1 });
const replies = [];
const interaction = { guildId: "test", locale: "pl", user: { id: "1", displayName: "Test" },
  options: { getSubcommand: () => "profile", getUser: () => null }, deferReply: async () => {}, editReply: async payload => replies.push(payload) };
const realPng = sharp.prototype.png;
try {
  sharp.prototype.png = function () { throw new Error("Private native rendering error"); };
  await handleScore(interaction);
} finally { sharp.prototype.png = realPng; }
assert.equal(replies[0].files, undefined);
assert.ok(replies[0].embeds[0].toJSON().description.includes("30 / 100 EXP"), "Rendering failure retains textual score and EXP");
assert.equal(replies[0].embeds[0].toJSON().title, "Test");
assert.ok(replies[0].embeds[0].toJSON().description.includes("#13"));
assert.ok(!replies[0].embeds[0].toJSON().description.includes("w rankingu serwera"));
assert.ok(!replies[0].embeds[0].toJSON().description.includes("Następny: poziom"));
assert.equal(replies[0].embeds[0].toJSON().fields[1].value, "1 (100%)", "Text fallback uses the same compact correct-answer statistic");
assert.deepEqual(replies[0].allowedMentions.parse, []);
await db.$disconnect();
if (process.argv.includes("--preview")) {
  const directory = new URL("../.tools/score-card-preview/", import.meta.url);
  await mkdir(directory, { recursive: true });
  let previewAvatar;
  const avatarOption = process.argv.indexOf("--avatar-path");
  if (avatarOption >= 0 && process.argv[avatarOption + 1]) {
    previewAvatar = await sharp(await readFile(process.argv[avatarOption + 1])).resize(144, 144).png().toBuffer();
  }
  for (const [name, card] of [["profile", data()], ["long-name", data("pl", "Bardzo długi nick 👨‍👩‍👧‍👦 Zażółć gęślą jaźń ".repeat(5))], ["level-up", data("pl", "Mehow", 10)],
    ...[1, 2, 3, 4, null].map(rank => [`rank-${rank ?? "unranked"}`, { ...data(), rank }])]) {
    await writeFile(new URL(`${name}.png`, directory), await sharp(Buffer.from(await scoreCardSvg(card, previewAvatar))).png().toBuffer());
  }
}
console.log("PASS: six-locale nickname-only PNG cards, compact podium and standard ranks, long-name spacing, exact progress and private fallback");
