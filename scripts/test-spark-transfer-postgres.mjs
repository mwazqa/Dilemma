import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Unexpected network request in transfer tests"); };
const { db } = await import("../dist/db.js");
const { transferSparks, maxTransferSparks } = await import("../dist/services/spark-transfer.js");
const { exchangeSparks } = await import("../dist/services/spark-exchange.js");
const { routeCommand, dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const guildId = "transfer-" + randomUUID(), otherGuild = guildId + "-other";
const originalTransaction = db.$transaction.bind(db);
const id = () => randomUUID();
const wallet = (userId, guild = guildId) => db.userScore.findUnique({ where: { guildId_userId: { guildId: guild, userId } } });
const seed = (userId, sparks, guild = guildId) => db.userScore.create({ data: { guildId: guild, userId, sparks } });
let language = "pl", stage = "command-validation";
async function command({ sender = "alice", recipient = "bob", amount = 1, requestId = id(), scope = guildId,
  bot = false, senderBot = false, member = true, memberError, sub = "transfer" } = {}) {
  let reply, lookups = 0;
  await routeCommand({ id: requestId, commandName: "dilemma", guildId: scope, locale: language,
    guild: scope ? { id: scope, members: { fetch: async options => {
      lookups++; assert.deepEqual(options, { user: recipient, force: true, cache: false });
      if (memberError) throw memberError;
      return member ? { id: recipient, guild: { id: scope } } : null;
    } } } : null,
    user: { id: sender, bot: senderBot }, options: { getSubcommandGroup: () => sub === "forget" ? "score" : "sparks", getSubcommand: () => sub,
      getUser: () => ({ id: recipient, bot }), getInteger: () => amount, getBoolean: () => true },
    deferReply: async options => assert.equal(options.flags, 64),
    editReply: async value => { assert.deepEqual(value.allowedMentions, { parse: [] }); reply = value.content; }
  });
  return { reply, lookups };
}
try {
  const option = dilemmaCommand.toJSON().options.find(item => item.name === "sparks").options.find(item => item.name === "transfer");
  assert.deepEqual(option.options.map(item => [item.name, item.required]), [["user", true], ["amount", true]]);
  assert.equal(option.options[1].min_value, 1); assert.equal(option.options[1].max_value, maxTransferSparks);
  await db.guildSettings.create({ data: { guildId, language } });
  await seed("alice", 20);
  for (language of messageLanguages) {
    await db.guildSettings.update({ where: { guildId }, data: { language } }); clearGuildSettingsCache();
    for (const [input, key] of [[{ recipient: "alice" }, "scoreTransferSelf"], [{ bot: true }, "scoreTransferBot"],
      [{ senderBot: true }, "scoreTransferBot"], [{ amount: 0 }, "scoreTransferInvalid"], [{ member: false }, "scoreTransferMemberOnly"],
      [{ memberError: { code: 10007 } }, "scoreTransferMemberOnly"], [{ memberError: Error("Synthetic lookup failure") }, "scoreTransferUnavailable"]]) {
      const value = await command(input); assert.equal(value.reply, message(language, key)); assert.ok(value.reply.includes(feedbackKaomoji[key]));
    }
    assert.equal((await command({ scope: null })).reply, message(language, "serverOnly"));
    const requestId = id();
    assert.equal((await command({ amount: 1, requestId })).reply, message(language, "scoreTransferDone", { amount: 1, user: "<@bob>" }));
    assert.equal((await command({ amount: 1, requestId })).reply, message(language, "scoreTransferDone", { amount: 1, user: "<@bob>" }));
  }
  assert.equal((await wallet("alice")).sparks, 18); assert.equal((await wallet("bob")).sparks, 2);
  assert.equal((await wallet("bob")).exp, 0n); assert.equal((await wallet("bob")).answered, 0);
  assert.equal(await db.sparkTransfer.count({ where: { guildId } }), 2);
  stage = "invalid-amounts-and-limits";
  for (const amount of [0, -1, 0.5, NaN, Infinity, maxTransferSparks + 1]) assert.equal((await transferSparks(id(), guildId, "alice", "bob", amount)).status, "invalid");
  assert.equal((await transferSparks(id(), guildId, "alice", "alice", 1)).status, "self");
  assert.deepEqual(await transferSparks(id(), guildId, "missing-sender", "missing-recipient", 1), { status: "insufficient", balance: 0 });
  assert.equal(await wallet("missing-recipient"), null);
  assert.equal((await command({ amount: 19 })).reply, message(language, "scoreTransferInsufficient", { amount: 19, balance: 18 }));
  await seed("full-wallet", maxTransferSparks);
  assert.equal((await command({ recipient: "full-wallet" })).reply, message(language, "scoreTransferLimit"));
  assert.equal((await wallet("alice")).sparks, 18);
  stage = "concurrent-replays";
  await seed("replay-sender", 30);
  const replayId = id();
  const repeated = await Promise.all(Array.from({ length: 4 }, () => transferSparks(replayId, guildId, "replay-sender", "replay-recipient", 7)));
  assert.ok(repeated.every(result => result.status === "transferred"));
  for (const result of repeated) assert.deepEqual(result.receipt, repeated[0].receipt);
  assert.equal((await wallet("replay-sender")).sparks, 23); assert.equal((await wallet("replay-recipient")).sparks, 7);
  assert.equal(await db.sparkTransfer.count({ where: { interactionId: replayId } }), 1);
  for (const args of [[otherGuild, "replay-sender", "replay-recipient", 7], [guildId, "other-sender", "replay-recipient", 7],
    [guildId, "replay-sender", "other-recipient", 7], [guildId, "replay-sender", "replay-recipient", 8]]) {
    assert.equal((await transferSparks(replayId, ...args)).status, "invalid");
  }
  stage = "overspend-and-opposite-transfers";
  await seed("limited", 5);
  const competing = await Promise.all([transferSparks(id(), guildId, "limited", "first", 4), transferSparks(id(), guildId, "limited", "second", 4)]);
  assert.deepEqual(competing.map(result => result.status).sort(), ["insufficient", "transferred"]);
  assert.equal((await wallet("limited")).sparks, 1);
  assert.equal(((await wallet("first"))?.sparks ?? 0) + ((await wallet("second"))?.sparks ?? 0), 4);
  await seed("opposite-a", 20); await seed("opposite-b", 20);
  const opposite = await Promise.all([transferSparks(id(), guildId, "opposite-a", "opposite-b", 7), transferSparks(id(), guildId, "opposite-b", "opposite-a", 5)]);
  assert.ok(opposite.every(result => result.status === "transferred"));
  assert.equal((await wallet("opposite-a")).sparks, 18); assert.equal((await wallet("opposite-b")).sparks, 22);
  stage = "shared-wallet-concurrency";
  await seed("mixed", 6);
  await Promise.all([transferSparks(id(), guildId, "mixed", "mixed-recipient", 5), exchangeSparks(id(), guildId, "mixed", 3)]);
  const mixed = await wallet("mixed"), received = (await wallet("mixed-recipient"))?.sparks ?? 0;
  assert.equal(mixed.sparks + received + Number(mixed.exp) / 3, 6); assert.ok(mixed.sparks >= 0);
  await seed("alice", 50, otherGuild);
  assert.equal((await wallet("alice", otherGuild)).sparks, 50);
  stage = "atomic-failure-and-retry";
  await seed("rollback", 10);
  const failedId = id();
  db.$transaction = (work, options) => originalTransaction(tx => work(new Proxy(tx, { get(target, field) {
    if (field === "sparkTransfer") return new Proxy(target.sparkTransfer, { get(model, method) {
      if (method === "create") return async () => { throw Error("Synthetic receipt failure"); };
      return Reflect.get(model, method);
    } });
    return Reflect.get(target, field);
  } })), options);
  await assert.rejects(transferSparks(failedId, guildId, "rollback", "rollback-recipient", 3), /Synthetic receipt failure/);
  db.$transaction = originalTransaction;
  assert.equal((await wallet("rollback")).sparks, 10); assert.equal(await wallet("rollback-recipient"), null);
  assert.equal(await db.sparkTransfer.count({ where: { interactionId: failedId } }), 0);
  assert.equal((await transferSparks(failedId, guildId, "rollback", "rollback-recipient", 3)).status, "transferred");
  assert.equal((await wallet("rollback")).sparks, 7);
  stage = "retired-command-and-replay-guard";
  await transferSparks(id(), guildId, "bob", "alice", 1);
  const aliceReceipt = await db.sparkTransfer.findFirstOrThrow({ where: { guildId, senderUserId: "alice" } });
  const receiptCount = await db.sparkTransfer.count({ where: { guildId } });
  const aliceBefore = await wallet("alice"), recipientBefore = await wallet(aliceReceipt.recipientUserId);
  const retired = await command({ sub: "forget" });
  assert.equal(retired.reply, message(language, "commandUnavailable")); assert.equal(retired.lookups, 0);
  assert.deepEqual(await wallet("alice"), aliceBefore);
  assert.equal((await wallet("alice", otherGuild)).sparks, 50);
  assert.equal(await db.sparkTransfer.count({ where: { guildId } }), receiptCount);
  assert.equal((await transferSparks(aliceReceipt.interactionId, guildId, "alice", aliceReceipt.recipientUserId, aliceReceipt.amount)).status, "transferred");
  assert.deepEqual(await wallet("alice"), aliceBefore);
  assert.deepEqual(await wallet(aliceReceipt.recipientUserId), recipientBefore);
  console.log(JSON.stringify({ check: "spark-transfer-postgres", passed: true, locales: 2, noFee: true, privateReceipt: true, membershipChecked: true,
    idempotent: true, noOverspend: true, crossGuildIsolation: true, atomicRollback: true, noExpGain: true, retiredCommandSafe: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "spark-transfer-postgres", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation",
    line: Number(error.stack?.match(/test-spark-transfer-postgres\.mjs:(\d+)/)?.[1] || 0) })); process.exitCode = 1;
} finally {
  db.$transaction = originalTransaction;
  await db.sparkTransfer.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.userScore.deleteMany({ where: { guildId: { in: [guildId, otherGuild] } } });
  await db.guildSettings.deleteMany({ where: { guildId } });
  globalThis.fetch = originalFetch; clearGuildSettingsCache(); await db.$disconnect();
}
