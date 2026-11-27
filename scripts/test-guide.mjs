import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
Object.assign(process.env, { DOTENV_CONFIG_PATH: ".tools/disabled-guide-tests.env", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test",
  DATABASE_URL_UNPOOLED: "", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const originalFetch = globalThis.fetch, realNow = Date.now, realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
globalThis.fetch = async () => { throw Error("Unexpected network request"); };
const { ComponentType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const { getPlayerGuideContentHash, getPlayerGuideText, getPlayerGuidePayload, LEGACY_GUIDE_REFRESH_BUTTON_ID } = await import("../dist/services/player-guide.js");
const { handleLegacyGuide } = await import("../dist/commands/guide.js");
const { routeCommand, dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { registerGuidePublication, publishGuideReleaseNotice } = await import("../dist/services/guide-publications.js");
const { discoverGuidePage, discoverArchivedGuideThreads, migrateLegacyGuide, startGuideUpdatesScheduler, updatePublishedGuide } = await import("../dist/services/guide-updates.js");
const { getReleaseNoticePayload, isCurrentReleasePublished, runningVersion, playerRelease } = await import("../dist/player-release.js");
const testRelease = { version: runningVersion, changes: { en: ["You can now transfer Sparks to other players."], pl: ["Możesz przesyłać Iskry innym graczom."] } };
const testReleasePayload = language => getReleaseNoticePayload(language, testRelease);
const publishTestReleaseNotice = (client, guildId, channelId, isPublished) =>
  publishGuideReleaseNotice(client, guildId, channelId, isPublished, () => true, testReleasePayload);
const { scheduleEvents } = await import("../dist/services/schedule-events.js");
const id = number => String(100000000000000000n + BigInt(number));
const guildId = id(1), channelId = id(2), botId = id(3), managerRoleId = id(4);
let publications = new Map(), receipts = new Map(), cursors = new Map(), stored, failRegistration = false, serial = Promise.resolve(), stop;
const noticeKey = value => `${value.guildId}:${value.channelId}:${value.version}`;
const cursorKey = value => `${value.channelId}:${value.kind}`;
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (value.in) return value.in.includes(row[key]);
    if (Object.hasOwn(value, "not")) return row[key] !== value.not;
  }
  return row[key] === value;
});
db.guildSettings.findUnique = async () => stored;
db.guildSettings.upsert = async () => { throw Error("Guides cannot change settings"); };
db.guidePublication.findUnique = async ({ where }) => publications.get(where.messageId) ?? null;
db.guidePublication.findMany = async ({ where }) => [...publications.values()].filter(row => matches(row, where));
db.guidePublication.count = async ({ where }) => [...publications.values()].filter(row => matches(row, where)).length;
db.guidePublication.upsert = async ({ where, create, update }) => {
  if (failRegistration) throw Error("Synthetic registration failure");
  const row = publications.get(where.messageId) ?? { active: true, genericAt: null, ...create };
  if (publications.has(where.messageId)) Object.assign(row, update);
  publications.set(where.messageId, row); return row;
};
db.guidePublication.update = async ({ where, data }) => Object.assign(publications.get(where.messageId), data);
db.guidePublication.updateMany = async ({ where, data }) => {
  const rows = [...publications.values()].filter(row => matches(row, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length };
};
db.guideReleaseNotice.findUnique = async ({ where }) => receipts.get(noticeKey(where.guildId_channelId_version)) ?? null;
db.guideReleaseNotice.upsert = async ({ where, create, update }) => {
  const key = noticeKey(where.guildId_channelId_version);
  const row = receipts.get(key) ?? { deliveredAt: null, ...create };
  if (receipts.has(key)) Object.assign(row, update);
  receipts.set(key, row); return row;
};
db.guideReleaseNotice.updateMany = async ({ where, data }) => {
  const rows = [...receipts.values()].filter(row => matches(row, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length };
};
db.guideReleaseNotice.update = async ({ where, data }) => Object.assign(receipts.get(noticeKey(where.guildId_channelId_version)), data);
db.guideDiscovery.findUnique = async ({ where }) => cursors.get(cursorKey(where.channelId_kind)) ?? null;
db.guideDiscovery.findMany = async ({ where }) => [...cursors.values()].filter(row => matches(row, where));
db.guideDiscovery.upsert = async ({ where, create, update }) => {
  const key = cursorKey(where.channelId_kind), row = cursors.get(key) ?? { completedAt: null, cursor: null, ...create };
  if (cursors.has(key)) Object.assign(row, update);
  cursors.set(key, row); return row;
};
db.guideDiscovery.update = async ({ where, data }) => Object.assign(cursors.get(cursorKey(where.channelId_kind)), data);
db.$transaction = (work) => {
  const next = serial.then(async () => {
    const before = structuredClone({ publications, receipts, cursors });
    try { return await work(db); } catch (error) { ({ publications, receipts, cursors } = before); throw error; }
  });
  serial = next.catch(() => {}); return next;
};
function reset(language = "pl") {
  publications.clear(); receipts.clear(); cursors.clear(); failRegistration = false;
  stored = { guildId, language, managerRoleId }; clearGuildSettingsCache();
}
function request(options = {}) {
  const result = { sent: [], edited: [], replies: [], cleaned: 0, deleted: 0 };
  const { language = "pl", permission = PermissionFlagsBits.ManageGuild, roles = [], source = {}, failSend = false, failEdit = false,
    failCleanup = false, sendable = true, requestGuild = guildId } = options;
  stored = { guildId: options.settingsGuild ?? guildId, language, managerRoleId: options.managerRole === null ? null : managerRoleId };
  clearGuildSettingsCache();
  return { id: "guide-invocation", commandName: "dilemma", guildId: requestGuild, channelId, locale: language === "pl" ? "en" : "pl",
    user: { id: id(5) }, member: { roles }, memberPermissions: new PermissionsBitField(permission), client: { user: { id: botId } },
    customId: options.customId ?? LEGACY_GUIDE_REFRESH_BUTTON_ID, options: { getSubcommandGroup: () => "guide", getSubcommand: () => "publish" },
    channel: { id: channelId, isTextBased: () => true, isSendable: () => sendable, send: async payload => {
      if (failSend) throw Error("Synthetic send failure"); result.sent.push(payload);
      return { id: id(6), delete: async () => { result.deleted++; } };
    } },
    message: { id: id(7), guildId, channelId, author: { id: botId }, flags: { has: () => false },
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, customId: LEGACY_GUIDE_REFRESH_BUTTON_ID }] }],
      edit: async payload => { if (failEdit) throw Error("Synthetic edit failure"); result.edited.push(payload); }, ...source },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); result.replies.push(payload); },
    deleteReply: async () => { result.cleaned++; if (failCleanup) throw Error("Synthetic cleanup failure"); }, result };
}
let stage = "generic-guide";
try {
  assert.equal(runningVersion, playerRelease.version);
  assert.ok(dilemmaCommand.toJSON().options.find(option => option.name === "guide").description.length <= 100);
  for (const language of messageLanguages) {
    const content = getPlayerGuideText(language), payload = getPlayerGuidePayload(language);
    assert.ok(content.length > 700 && content.replace(/\n/g, "\r\n").length <= 4000);
    assert.doesNotMatch(content, /\{\w+\}|^#{1,6}\s|<@|@everyone|@here|\b\d+\s*(?:Sparks|Iskier|EXP)\b/m);
    assert.ok(!content.includes("/dilemma guide publish"));
    assert.ok(content.includes("/dilemma profile"));
    assert.ok(content.includes("/dilemma sparks exchange"));
    assert.ok(!content.includes("/dilemma score profile"));
    for (const key of ["myQuizVoteButton", "myQuizResultButton", "quizReportButton"]) assert.ok(content.includes(message(language, key)));
    assert.equal(payload.embeds[0].toJSON().description, content); assert.deepEqual(payload.components, []);
    assert.deepEqual(payload.allowedMentions.parse, []);
    assert.equal(readFileSync(`docs/player-guide.${language}.md`, "utf8").replace(/\r\n/g, "\n"), content + "\n");
    const news = getReleaseNoticePayload(language);
    if (!playerRelease.changes[language].length) assert.equal(news, null);
    else {
      assert.ok(news.content.includes(runningVersion)); assert.ok(news.content.includes(feedbackKaomoji.releaseUpdateHeading));
      assert.ok(news.content.length <= 2000); assert.deepEqual(news.allowed_mentions.parse, []);
    }
    const fixtureNews = testReleasePayload(language);
    assert.ok(fixtureNews.content.includes(testRelease.changes[language][0]));
    assert.ok(fixtureNews.content.includes(feedbackKaomoji.releaseUpdateHeading));
    assert.deepEqual(fixtureNews.allowed_mentions.parse, []);
  }
  stage = "release-highlights";
  const quietRelease = { version: runningVersion, changes: { en: [], pl: [] } };
  for (const language of messageLanguages) assert.equal(getReleaseNoticePayload(language, quietRelease), null);
  assert.throws(() => getReleaseNoticePayload("en", { ...quietRelease, version: "0.0.0" }), /need review/);
  for (const changes of [{ en: ["New player feature"], pl: [] }, { en: [], pl: ["Nowa funkcja dla graczy"] }]) {
    assert.throws(() => getReleaseNoticePayload("en", { version: runningVersion, changes }), /both languages/);
  }
  for (const language of messageLanguages) {
    const changes = { en: [" "], pl: ["Nowa funkcja dla graczy"] };
    assert.throws(() => getReleaseNoticePayload(language, { version: runningVersion, changes }), /cannot be blank/);
  }
  stage = "publishing";
  for (const language of messageLanguages) for (const access of [{ permission: PermissionFlagsBits.ManageGuild },
    { permission: PermissionFlagsBits.Administrator }, { permission: 0n, roles: [managerRoleId] }]) {
    reset(language); const value = request({ language, ...access }); await routeCommand(value);
    assert.equal(value.result.sent.length, 1); assert.deepEqual(value.result.sent[0].components, []);
    assert.equal(value.result.sent[0].nonce, "guide-invocation"); assert.equal(value.result.sent[0].enforceNonce, true);
    assert.equal(value.result.replies.length, 0); assert.equal(value.result.cleaned, 1);
    assert.equal(publications.size, 1); assert.ok([...publications.values()][0].genericAt);
    assert.equal([...publications.values()][0].contentHash, getPlayerGuideContentHash(language));
    assert.ok([...receipts.values()][0].deliveredAt, "A new channel starts with the next release");
  }
  for (const access of [{ permission: 0n }, { permission: 0n, roles: [id(8)] }, { permission: 0n, roles: [managerRoleId], managerRole: null },
    { permission: 0n, roles: [managerRoleId], settingsGuild: id(9) }]) {
    reset(); const value = request(access); await routeCommand(value);
    assert.equal(value.result.sent.length, 0); assert.equal(publications.size, 0);
    assert.equal(value.result.replies[0].content, message("pl", "permission"));
  }
  reset(); let value = request({ requestGuild: null }); await routeCommand(value);
  assert.equal(value.result.replies[0].content, message("en", "serverOnly"));
  value = request({ sendable: false }); await routeCommand(value); assert.equal(value.result.sent.length, 0);
  value = request({ failSend: true }); await routeCommand(value); assert.equal(publications.size, 0);
  assert.equal(value.result.replies[0].content, message("pl", "guidePublishFailed"));
  failRegistration = true; value = request(); await routeCommand(value);
  assert.equal(value.result.deleted, 1); assert.equal(value.result.replies[0].content, message("pl", "guideSubscribeFailed"));
  assert.equal(receipts.size, 0);
  reset(); value = request({ failCleanup: true }); await routeCommand(value);
  assert.equal(value.result.replies[0].content, message("pl", "guidePublished"));
  stage = "legacy-removal";
  reset(); value = request({ permission: 0n }); await handleLegacyGuide(value);
  assert.equal(value.result.edited.length, 1); assert.deepEqual(value.result.edited[0].components, []);
  assert.equal(receipts.size, 0, "An existing guide receives the new release announcement");
  for (const source of [{ author: { id: id(8) } }, { guildId: id(9) }, { channelId: id(9) }, { flags: { has: () => true } }, { components: [] }]) {
    reset(); value = request({ source, permission: 0n }); await handleLegacyGuide(value);
    assert.equal(value.result.edited.length, 0); assert.equal(publications.size, 0);
  }
  reset(); value = request({ failEdit: true }); await handleLegacyGuide(value);
  assert.equal([...publications.values()][0].genericAt, null, "A failed migration remains resumable");
  stage = "release-delivery";
  reset(); const identity = { guildId, channelId, messageId: id(10) };
  await registerGuidePublication(identity, true); await registerGuidePublication({ ...identity, messageId: id(11) }, true);
  const posts = [];
  const client = { user: { id: botId }, rest: { post: async (route, { body }) => {
    assert.equal(route, `/channels/${channelId}/messages`); assert.deepEqual(body.allowed_mentions.parse, []);
    assert.equal(body.enforce_nonce, true); assert.ok(body.nonce.length <= 25); posts.push(body); return { id: id(12) };
  } } };
  assert.equal(await publishTestReleaseNotice(client, guildId, channelId, async () => false), "unpublished"); assert.equal(posts.length, 0);
  assert.equal(await publishTestReleaseNotice(client, guildId, channelId, async () => true), "sent");
  assert.equal(await publishTestReleaseNotice(client, guildId, channelId, async () => true), "done");
  assert.equal(posts.length, 1); assert.equal(receipts.size, 1, "Multiple guides in one channel produce one release message");
  reset(); await registerGuidePublication(identity, true);
  await assert.rejects(publishTestReleaseNotice({ rest: { post: async () => { throw Error("Synthetic delivery failure"); } } }, guildId, channelId, async () => true));
  assert.equal(receipts.size, 0); assert.equal(await publishTestReleaseNotice(client, guildId, channelId, async () => true), "sent");
  reset(); await registerGuidePublication(identity, true);
  assert.equal(await publishTestReleaseNotice({ rest: { post: async () => { throw { code: 10003 }; } } }, guildId, channelId, async () => true), "empty");
  assert.equal(publications.get(identity.messageId).active, false, "Deleted channels stop receiving retries");
  stage = "quiet-release";
  reset(); await registerGuidePublication(identity, true);
  const postsBeforeQuiet = posts.length, noHighlights = () => null;
  assert.equal(await publishGuideReleaseNotice(client, guildId, channelId, async () => false, () => true, noHighlights), "unpublished");
  assert.equal(receipts.size, 0, "A quiet release still waits for GitHub publication");
  await assert.rejects(publishGuideReleaseNotice(client, guildId, channelId, async () => true, () => false, noHighlights), /Guide update stopped/);
  assert.equal(receipts.size, 0, "Stopping before processing leaves the quiet release resumable");
  assert.equal(await publishGuideReleaseNotice(client, guildId, channelId, async () => true, () => true, noHighlights), "skipped");
  const quietReceipt = [...receipts.values()][0];
  assert.ok(quietReceipt.deliveredAt); assert.equal(quietReceipt.messageId, null);
  assert.equal(await publishGuideReleaseNotice(client, guildId, channelId, async () => true, () => true, noHighlights), "done");
  assert.equal(posts.length, postsBeforeQuiet, "Minor-only releases never send a guide-channel message");
  stage = "in-place-guide-update";
  const guideRoute = `/channels/${channelId}/messages/${identity.messageId}`;
  const guideMessage = { id: identity.messageId, channel_id: channelId, author: { id: botId },
    embeds: [{ description: getPlayerGuideText("en") }], components: [] };
  let guideReads = 0, guideEdits = 0, failGuideEdit = true;
  const guideClient = { user: client.user, rest: {
    get: async route => { assert.equal(route, guideRoute); guideReads++; return guideMessage; },
    patch: async (route, { body }) => {
      assert.equal(route, guideRoute);
      assert.deepEqual(body.components, []); assert.deepEqual(body.allowed_mentions.parse, []);
      if (failGuideEdit) throw Error("Synthetic edit failure");
      guideEdits++; guideMessage.embeds = body.embeds;
    }
  } };
  assert.equal(await updatePublishedGuide(guideClient, identity.messageId, async () => false), "unpublished");
  assert.equal(guideReads, 0);
  await assert.rejects(updatePublishedGuide(guideClient, identity.messageId, async () => true), /Synthetic edit failure/);
  assert.ok(!publications.get(identity.messageId).contentHash, "A failed edit leaves the update pending");
  failGuideEdit = false;
  assert.equal(await updatePublishedGuide(guideClient, identity.messageId, async () => true), "done");
  assert.equal(guideMessage.embeds[0].description, getPlayerGuideText("pl"));
  assert.equal(publications.get(identity.messageId).contentHash, getPlayerGuideContentHash("pl"));
  assert.equal(await updatePublishedGuide(guideClient, identity.messageId), "done");
  assert.equal(guideReads, 2); assert.equal(guideEdits, 1);
  assert.equal(posts.length, postsBeforeQuiet, "A guide edit creates no release message");
  publications.get(identity.messageId).contentHash = null;
  assert.equal(await updatePublishedGuide(guideClient, identity.messageId, async () => true), "done");
  assert.equal(guideReads, 3); assert.equal(guideEdits, 1, "An existing edit is recorded without sending it again");
  publications.get(identity.messageId).contentHash = null;
  guideMessage.author.id = id(99);
  assert.equal(await updatePublishedGuide(guideClient, identity.messageId, async () => true), "unavailable");
  assert.equal(publications.get(identity.messageId).active, false);
  assert.equal(guideEdits, 1);
  stage = "history-discovery";
  reset(); await db.guideDiscovery.upsert({ where: { channelId_kind: { channelId, kind: "messages" } }, create: { channelId, kind: "messages", guildId }, update: {} });
  const legacy = number => ({ id: id(number), channel_id: channelId, author: { id: botId }, components: [{ type: 1, components: [{ type: 2, custom_id: LEGACY_GUIDE_REFRESH_BUTTON_ID }] }] });
  let reads = 0, patches = 0;
  const page = Array.from({ length: 100 }, (_, index) => ({ id: id(2000 - index), channel_id: channelId, author: { id: id(50) }, get content() { throw Error("Unrelated content read"); } }));
  page[20] = legacy(1980);
  const historyClient = { user: { id: botId }, rest: { get: async (route, options) => {
    if (route === `/channels/${channelId}/messages`) { reads++; if (reads === 1) { assert.equal(options.query.get("before"), null); return page; }
      assert.equal(options.query.get("before"), id(1901)); return [legacy(1900)]; }
    return legacy(1980);
  }, patch: async (_, { body }) => { assert.deepEqual(body.components, []); assert.deepEqual(body.allowed_mentions.parse, []); patches++; } } };
  assert.equal((await discoverGuidePage(historyClient, channelId)).more, true);
  assert.equal((await discoverGuidePage(historyClient, channelId)).more, false);
  assert.equal(publications.size, 2); assert.equal((await discoverGuidePage(historyClient, channelId)).more, false); assert.equal(reads, 2);
  await migrateLegacyGuide(historyClient, id(1980)); await migrateLegacyGuide(historyClient, id(1980));
  assert.equal(patches, 1); assert.ok(publications.get(id(1980)).genericAt);
  await db.guideDiscovery.upsert({ where: { channelId_kind: { channelId, kind: "public" } }, create: { channelId, kind: "public", guildId }, update: {} });
  const archivedClient = { rest: { get: async () => ({ has_more: false, threads: [{ id: id(3000), guild_id: guildId, parent_id: channelId,
    thread_metadata: { archive_timestamp: "2026-11-17T00:00:00Z" } }] }) } };
  assert.deepEqual((await discoverArchivedGuideThreads(archivedClient, channelId, "public")).found, [id(3000)]);
  assert.ok(cursors.has(`${id(3000)}:messages`));
  stage = "published-release-gate";
  let now = realNow(), checks = 0, ready = false;
  Date.now = () => now;
  globalThis.fetch = async (url, options) => { checks++; assert.ok(String(url).endsWith(`/releases/tags/v${runningVersion}`));
    assert.equal(options.headers.accept, "application/vnd.github+json");
    return ready ? new Response(JSON.stringify({ tag_name: `v${runningVersion}`, draft: false, prerelease: false }), { status: 200 }) : new Response("", { status: 404 }); };
  assert.equal(await isCurrentReleasePublished(), false); assert.equal(await isCurrentReleasePublished(), false); assert.equal(checks, 1);
  now += 120001; ready = true; assert.equal(await isCurrentReleasePublished(), true); assert.equal(checks, 2);
  Date.now = realNow; globalThis.fetch = async () => { throw Error("Unexpected repeated release lookup"); };
  stage = "scheduler";
  reset(); await registerGuidePublication(identity, true);
  guideMessage.author.id = botId; guideMessage.embeds = [{ description: "Old guide text" }];
  let time = realNow(), sequence = 0, requests = 0;
  const timers = new Map();
  Date.now = () => time;
  globalThis.setTimeout = (callback, delay = 0) => { const timer = { id: ++sequence, at: time + delay, callback, unref() { return this; } }; timers.set(timer.id, timer); return timer; };
  globalThis.clearTimeout = timer => timers.delete(timer?.id);
  const channel = { id: channelId, guildId, type: 0, threads: {}, isTextBased: () => true, isSendable: () => true, permissionsFor: () => ({ has: () => true }) };
  const worker = { user: { id: botId }, guilds: { cache: new Map([[guildId, { id: guildId, members: { me: {} }, channels: {
    fetch: async () => new Map([[channelId, channel]]), fetchActiveThreads: async () => ({ threads: new Map() }) } }]]) }, rest: {
      get: async route => {
        requests++;
        if (route === guideRoute) return guideClient.rest.get(route);
        return route === `/channels/${channelId}/messages` ? [] : { threads: [], has_more: false };
      }, patch: guideClient.rest.patch, post: client.rest.post
    } };
  async function advance(ms) { const end = time + ms; let count = 0;
    while (true) { const timer = [...timers.values()].filter(item => item.at <= end).sort((a, b) => a.at - b.at)[0]; if (!timer) break;
      assert.ok(++count < 100); time = timer.at; timers.delete(timer.id); timer.callback(); await new Promise(resolve => setImmediate(resolve)); }
    time = end; await new Promise(resolve => setImmediate(resolve)); }
  stop = startGuideUpdatesScheduler(worker); await advance(0);
  assert.equal(posts.length, 2 + Number(Boolean(playerRelease.changes.en.length)));
  assert.ok([...receipts.values()][0].deliveredAt);
  assert.equal(guideEdits, 2); assert.equal(guideMessage.embeds[0].description, getPlayerGuideText("pl"));
  const idleRequests = requests; await advance(86400000); assert.equal(requests, idleRequests);
  stop(); assert.equal(timers.size, 0); assert.equal(scheduleEvents.listenerCount("guidePublished"), 0);
  console.log(JSON.stringify({ check: "guide", passed: true, genericCopy: true, noRefreshButton: true, permissions: true, subscriptions: true,
    legacyDiscovery: true, migrationResumes: true, releaseGate: true, inPlaceUpdates: true, oneNoticePerChannel: true, quietReleases: true, idleScheduler: true }));
} catch (error) {
  console.log(JSON.stringify({ check: "guide", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "operation",
    line: Number(error.stack?.match(/test-guide\.mjs:(\d+)/)?.[1] || 0),
    actualCount: typeof error.actual === "number" ? error.actual : undefined,
    expectedCount: typeof error.expected === "number" ? error.expected : undefined })); process.exitCode = 1;
} finally { stop?.(); globalThis.fetch = originalFetch; Date.now = realNow; globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
  clearGuildSettingsCache(); await db.$disconnect(); }
