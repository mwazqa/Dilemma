import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
globalThis.fetch = async () => { throw new Error("Unexpected network request in exchange test"); };

const { MessageFlags } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { routeCommand } = await import("../dist/commands/dilemma.js");
const { message } = await import("../dist/messages.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const { exchangeSparks } = await import("../dist/services/spark-exchange.js");
const { expPerSpark, maxWalletValue, sparksPerLevel } = await import("../dist/services/sparks.js");

const guildId = `exchange-${randomUUID()}`;
const otherGuild = `${guildId}-other`;
const player = (userId, guild = guildId) => db.userScore.findUnique({ where: { guildId_userId: { guildId: guild, userId } } });
const receiptId = () => randomUUID();

async function command(sub, userId, options = {}) {
  let reply;
  await routeCommand({
    id: options.id ?? receiptId(), commandName: "dilemma", guildId: options.guildId === null ? null : guildId, locale: "pl",
    user: { id: userId, displayName: "Synthetic player" },
    options: {
      getSubcommandGroup: () => "score", getSubcommand: () => sub, getUser: () => null,
      getInteger: () => options.amount, getBoolean: () => options.confirm, getString: name => name === "achievement" ? options.badge : null
    },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => { reply = payload; }
  });
  return reply;
}

async function scoreQuiz(userId, difficulty, index) {
  const finishedAt = new Date(Date.UTC(2026, 0, index));
  const settlement = await db.quizSettlement.create({ data: {
    guildId, channelId: "synthetic-channel", messageId: `${guildId}-quiz-${index}`, difficulty,
    correctAnswerId: 1, answerIds: "1,2", expiresAt: finishedAt
  } });
  assert.equal(await applyFinalVotes(settlement, [{ userId, answerId: 1 }], finishedAt), true);
}

let stage = "command-and-quiz-progress";
try {
  const quizPlayer = "quiz-player";
  await scoreQuiz(quizPlayer, "hard", 1);
  await scoreQuiz(quizPlayer, "hard", 2);
  await scoreQuiz(quizPlayer, "medium", 3);
  const progressCost = 4;
  const purchasedExp = 12;
  const success = await command("exchange", quizPlayer, { amount: progressCost });
  assert.equal(success.content, message("pl", "scoreExchangeDone", { amount: progressCost, exp: purchasedExp, balance: 8 - progressCost, level: 1 }));
  const profile = await command("profile", quizPlayer);
  assert.ok((profile.files?.[0]?.description ?? profile.embeds[0].toJSON().description).includes(`${80 + purchasedExp} / 100 EXP`));
  assert.equal((await player(quizPlayer)).points, 8);
  await scoreQuiz(quizPlayer, "easy", 4);
  const scored = await player(quizPlayer);
  assert.deepEqual([scored.points, scored.sparks, scored.bonusExp], [9, 9 - progressCost + sparksPerLevel, purchasedExp]);

  stage = "concurrent-replay-and-level-up";
  const buyer = "buyer";
  const cost = Math.ceil(100 / expPerSpark);
  await db.userScore.createMany({ data: [{ guildId, userId: buyer, sparks: cost + 2 }, { guildId: otherGuild, userId: buyer, sparks: 30 }] });
  const id = receiptId();
  const attempts = await Promise.all(Array.from({ length: 3 }, () => exchangeSparks(id, guildId, buyer, cost)));
  assert.ok(attempts.every(result => result.status === "exchanged"));
  assert.deepEqual(attempts.map(result => result.receipt), Array(3).fill(attempts[0].receipt));
  assert.equal(await db.sparkExchange.count({ where: { guildId, userId: buyer } }), 1);
  const exchange = attempts[0].receipt;
  assert.equal(exchange.levelAfter, 2);
  assert.equal(exchange.levelReward, sparksPerLevel);
  assert.equal(exchange.sparksAfter, 2 + sparksPerLevel);
  const buyerScore = await player(buyer);
  assert.deepEqual([buyerScore.points, buyerScore.bonusExp], [0, cost * expPerSpark]);
  const levelUp = await command("exchange", buyer, { id, amount: cost });
  assert.equal(levelUp.content, message("pl", "scoreExchangeLevelUp", {
    amount: cost, exp: cost * expPerSpark, balance: 2 + sparksPerLevel, level: 2, reward: sparksPerLevel
  }));
  assert.equal((await exchangeSparks(id, otherGuild, buyer, cost)).status, "invalid");
  const badge = await command("badge", buyer, { badge: "level_2" });
  assert.match(badge.content, /Pierwszy awans/);
  assert.equal((await player(buyer)).selectedBadge, "level_2");

  stage = "insufficient-balance-and-isolation";
  const competing = await Promise.all(Array.from({ length: 2 }, () => exchangeSparks(receiptId(), guildId, buyer, 6)));
  assert.deepEqual(competing.map(result => result.status).sort(), ["exchanged", "insufficient"]);
  assert.equal((await player(buyer)).sparks, 1);
  assert.equal((await player(buyer, otherGuild)).sparks, 30);
  assert.equal((await player(buyer, otherGuild)).bonusExp, 0);
  const insufficient = await command("exchange", buyer, { amount: 2 });
  assert.equal(insufficient.content, message("pl", "scoreExchangeInsufficient", { amount: 2, balance: 1 }));
  const direct = await command("exchange", buyer, { amount: 1, guildId: null });
  assert.equal(direct.content, message("pl", "serverOnly"));
  assert.equal((await exchangeSparks(receiptId(), guildId, buyer, -1)).status, "invalid");
  assert.equal((await player(buyer)).sparks, 1);

  stage = "integer-limit-and-forget";
  await db.userScore.create({ data: { guildId, userId: "limit", sparks: 10, bonusExp: maxWalletValue - 1 } });
  assert.equal((await exchangeSparks(receiptId(), guildId, "limit", 1)).status, "limit");
  assert.equal((await player("limit")).sparks, 10);
  await command("forget", buyer, { confirm: true });
  assert.equal(await player(buyer), null);
  assert.equal(await db.sparkExchange.count({ where: { guildId, userId: buyer } }), 0);
  assert.equal((await player(buyer, otherGuild)).sparks, 30);
  console.log(JSON.stringify({ check: "spark-exchange-postgres", passed: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "spark-exchange-postgres", passed: false, stage,
    category: error instanceof assert.AssertionError ? "assertion" : "operation",
    line: Number(error.stack?.match(/test-spark-exchange-postgres\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  await db.quizSettlement.deleteMany({ where: { guildId } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.$disconnect();
}
