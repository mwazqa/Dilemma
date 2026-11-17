import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Unexpected network request"); };
const { db } = await import("../dist/db.js");
const { registerGuidePublication, publishGuideReleaseNotice } = await import("../dist/services/guide-publications.js");
const { discoverGuidePage, migrateLegacyGuide } = await import("../dist/services/guide-updates.js");
const { LEGACY_GUIDE_REFRESH_BUTTON_ID, getPlayerGuideText } = await import("../dist/services/player-guide.js");
const { runningVersion } = await import("../dist/player-release.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const guildId = "guide-test-" + randomUUID();
const base = 100000000000000000n + BigInt("0x" + createHash("sha256").update(guildId).digest("hex").slice(0, 12));
const id = number => String(base + BigInt(number));
const published = new Map(); let attempts = 0, stage = "registration";
const client = { user: { id: "synthetic-bot" }, rest: { post: async (route, { body }) => {
  attempts++; assert.ok(route.startsWith("/channels/")); assert.deepEqual(body.allowed_mentions.parse, []);
  assert.equal(body.enforce_nonce, true); assert.ok(body.nonce.length <= 25);
  if (!published.has(body.nonce)) published.set(body.nonce, { id: id(900 + published.size) });
  return published.get(body.nonce);
} } };
try {
  await db.guildSettings.create({ data: { guildId, language: "pl" } });
  const newGuide = { guildId, channelId: id(1), messageId: id(2) };
  await registerGuidePublication(newGuide);
  assert.equal(await db.guidePublication.count({ where: { guildId } }), 1);
  assert.equal(await publishGuideReleaseNotice(client, guildId, newGuide.channelId, async () => true), "done");
  assert.equal(attempts, 0, "A new guide does not immediately replay the current release");
  await assert.rejects(registerGuidePublication({ ...newGuide, guildId: "other-test-guild" }), /Guide identity mismatch/);
  assert.equal(await db.guidePublication.count({ where: { guildId: "other-test-guild", messageId: newGuide.messageId } }), 0);
  stage = "concurrent-notices";
  const legacy = { guildId, channelId: id(3), messageId: id(4) };
  await registerGuidePublication(legacy, true); await registerGuidePublication({ ...legacy, messageId: id(5) }, true);
  assert.equal(await publishGuideReleaseNotice(client, guildId, legacy.channelId, async () => false), "unpublished");
  const notices = await Promise.all(Array.from({ length: 3 }, () => publishGuideReleaseNotice(client, guildId, legacy.channelId, async () => true)));
  assert.equal(notices.filter(value => value === "sent").length, 1); assert.equal(published.size, 1);
  const receipt = await db.guideReleaseNotice.findUniqueOrThrow({ where: { guildId_channelId_version: { guildId, channelId: legacy.channelId, version: runningVersion } } });
  assert.ok(receipt.deliveredAt); assert.ok(receipt.messageId);
  assert.equal(await publishGuideReleaseNotice(client, guildId, legacy.channelId, async () => true), "done");
  assert.equal(published.size, 1);
  stage = "delivery-failure";
  const failed = { guildId, channelId: id(6), messageId: id(7) };
  await registerGuidePublication(failed, true);
  const before = await db.guideReleaseNotice.count({ where: { guildId } });
  await assert.rejects(publishGuideReleaseNotice({ rest: { post: async () => { throw Error("Synthetic send failure"); } } }, guildId, failed.channelId, async () => true));
  assert.equal(await db.guideReleaseNotice.count({ where: { guildId } }), before);
  assert.equal(await publishGuideReleaseNotice(client, guildId, failed.channelId, async () => true), "sent");
  assert.equal(published.size, 2);
  stage = "saved-history-cursor";
  const historyChannel = id(8), messageId = id(9);
  await db.guideDiscovery.create({ data: { channelId: historyChannel, guildId } });
  const source = { id: messageId, channel_id: historyChannel, author: { id: "synthetic-bot" }, flags: 0,
    components: [{ type: 1, components: [{ type: 2, custom_id: LEGACY_GUIDE_REFRESH_BUTTON_ID }] }] };
  let patches = 0;
  const historyClient = { user: client.user, rest: {
    get: async route => route.endsWith("/messages") ? [source] : source,
    patch: async (_, { body }) => { patches++; assert.deepEqual(body.components, []); assert.equal(body.embeds[0].description, getPlayerGuideText("pl")); }
  } };
  const page = await discoverGuidePage(historyClient, historyChannel);
  assert.deepEqual(page.found, [messageId]); assert.equal(page.more, false);
  const cursor = await db.guideDiscovery.findUniqueOrThrow({ where: { channelId_kind: { channelId: historyChannel, kind: "messages" } } });
  assert.ok(cursor.completedAt); assert.equal(cursor.cursor, messageId);
  assert.equal((await db.guidePublication.findUniqueOrThrow({ where: { messageId } })).genericAt, null);
  await migrateLegacyGuide(historyClient, messageId); await migrateLegacyGuide(historyClient, messageId);
  assert.equal(patches, 1); assert.ok((await db.guidePublication.findUniqueOrThrow({ where: { messageId } })).genericAt);
  assert.equal(await publishGuideReleaseNotice(client, guildId, historyChannel, async () => true), "sent");
  assert.equal(published.size, 3);
  console.log(JSON.stringify({ check: "guide-postgres", passed: true, subscriptionBaseline: true, concurrentAnnouncements: true,
    failedSendRetained: true, historyCursorPersisted: true, legacyConversionOnce: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "guide-postgres", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation",
    line: Number(error.stack?.match(/test-guide-postgres\.mjs:(\d+)/)?.[1] || 0) })); process.exitCode = 1;
} finally {
  await db.guideReleaseNotice.deleteMany({ where: { guildId } });
  await db.guidePublication.deleteMany({ where: { guildId } });
  await db.guideDiscovery.deleteMany({ where: { guildId } });
  await db.guildSettings.deleteMany({ where: { guildId } });
  globalThis.fetch = originalFetch; clearGuildSettingsCache(); await db.$disconnect();
}
