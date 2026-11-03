import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
Object.assign(process.env, { DOTENV_CONFIG_PATH: ".tools/disabled-guide-tests.env", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test",
  DATABASE_URL_UNPOOLED: "", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request in guide test"); };
const { ComponentType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const { clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
const { getPlayerGuideText, getPlayerGuidePayload, GUIDE_REFRESH_BUTTON_ID } = await import("../dist/services/player-guide.js");
const { handleGuideRefresh } = await import("../dist/commands/guide.js");
const { dilemmaCommand, routeCommand } = await import("../dist/commands/dilemma.js");
const { getHelpContent } = await import("../dist/commands/help.js");
let stored, stage = "content";
db.guildSettings.findUnique = async () => stored;
db.guildSettings.upsert = async () => { throw new Error("Guide must not write settings"); };
const managerRoleId = "guide-manager";
async function invoke(refresh = false, options = {}) {
  const { language = "pl", locale = "en", guildId = "guide-guild", permission = PermissionFlagsBits.ManageGuild,
    roles = [], managerRole = managerRoleId, settingsGuildId = guildId, sendable = true,
    failSend = false, failEdit = false, failCleanup = false, source = {}, customId = GUIDE_REFRESH_BUTTON_ID } = options;
  stored = { guildId: settingsGuildId, language, managerRoleId: managerRole };
  clearGuildSettingsCache();
  const result = { sent: [], edited: [], privateReplies: [], sendAttempts: 0, editAttempts: 0, cleaned: 0 };
  const request = { id: "guide-invocation", commandName: "dilemma", guildId, channelId: "guide-channel", locale,
    user: { id: "guide-member" }, member: { roles }, memberPermissions: new PermissionsBitField(permission),
    client: { user: { id: "guide-bot" } }, customId,
    options: { getSubcommandGroup: () => null, getSubcommand: () => "guide" },
    channel: { isTextBased: () => true, isSendable: () => sendable, send: async payload => {
      result.sendAttempts++;
      if (failSend) throw new Error("Synthetic send failure");
      result.sent.push(payload); return { id: "published-guide" };
    } },
    message: { id: "old-guide", guildId, channelId: "guide-channel", author: { id: "guide-bot" },
      flags: { has: () => false }, embeds: [{ description: "Old guide text" }],
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, customId: GUIDE_REFRESH_BUTTON_ID }] }],
      edit: async payload => {
        result.editAttempts++;
        if (failEdit) throw new Error("Synthetic edit failure");
        result.edited.push(payload); return { id: "old-guide" };
      }, ...source },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => {
      assert.deepEqual(payload.allowedMentions.parse, []);
      assert.ok(payload.content.length <= 2000); result.privateReplies.push(payload);
    },
    deleteReply: async () => { result.cleaned++; if (failCleanup) throw new Error("Synthetic cleanup failure"); }
  };
  if (refresh) await handleGuideRefresh(request);
  else await routeCommand(request);
  return result;
}
try {
  const command = dilemmaCommand.toJSON().options.find(option => option.name === "guide");
  assert.equal(command.type, 1);
  assert.ok(command.description.length <= 100);
  for (const language of messageLanguages) {
    const content = getPlayerGuideText(language);
    assert.ok(content.length > 2000 && content.replace(/\n/g, "\r\n").length <= 4000);
    assert.doesNotMatch(content, /\{\w+\}|^#{1,6}\s|<@|@everyone|@here/m);
    assert.ok(content.includes(feedbackKaomoji.playerGuide));
    for (const key of ["myQuizVoteButton", "quizJumpButton", "wagerButton", "myQuizResultButton", "endQuizButton", "guideRefreshButton"]) {
      assert.ok(content.includes(message(language, key)));
    }
    assert.equal(readFileSync(`docs/player-guide.${language}.md`, "utf8").replace(/\r\n/g, "\n"), content + "\n");
    assert.ok(getHelpContent(language).includes("/dilemma guide"));
    const payload = getPlayerGuidePayload(language);
    assert.deepEqual(payload.allowedMentions.parse, []);
    assert.equal(payload.embeds.length, 1);
    assert.equal(payload.embeds[0].toJSON().description, content);
    assert.equal(payload.components[0].toJSON().components[0].custom_id, GUIDE_REFRESH_BUTTON_ID);
    assert.equal(payload.components[0].toJSON().components[0].label, message(language, "guideRefreshButton"));
    for (const key of ["guidePublished", "guidePublishFailed", "guideRefreshFailed", "guideUnavailable"]) {
      assert.ok(message(language, key).includes(feedbackKaomoji[key]));
    }
  }
  stage = "publishing";
  for (const language of messageLanguages) for (const access of [
    { permission: PermissionFlagsBits.ManageGuild }, { permission: PermissionFlagsBits.Administrator },
    { permission: 0n, roles: [managerRoleId] }, { permission: 0n, roles: { cache: new Map([[managerRoleId, {}]]) } }
  ]) {
    const result = await invoke(false, { language, locale: language === "pl" ? "en" : "pl", ...access });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].embeds[0].toJSON().description, getPlayerGuideText(language));
    assert.equal(result.sent[0].nonce, "guide-invocation"); assert.equal(result.sent[0].enforceNonce, true);
    assert.equal(result.privateReplies.length, 0); assert.equal(result.cleaned, 1);
  }
  stage = "access";
  for (const refresh of [false, true]) for (const access of [
    { permission: 0n }, { permission: 0n, roles: ["other-role"] },
    { permission: 0n, roles: [managerRoleId], managerRole: null },
    { permission: 0n, roles: [managerRoleId], settingsGuildId: "other-guild" },
    { permission: 0n, roles: ["guide-guild"], managerRole: "guide-guild" }
  ]) {
    const result = await invoke(refresh, access);
    assert.equal(result.sendAttempts, 0); assert.equal(result.editAttempts, 0);
    assert.equal(result.privateReplies[0].content, message("pl", "permission"));
  }
  for (const refresh of [false, true]) {
    const result = await invoke(refresh, { guildId: null, locale: "pl" });
    assert.equal(result.privateReplies[0].content, message("pl", "serverOnly"));
    assert.equal(result.sendAttempts, 0); assert.equal(result.editAttempts, 0);
  }
  let result = await invoke(false, { sendable: false });
  assert.equal(result.privateReplies[0].content, message("pl", "channel"));
  assert.equal(result.sendAttempts, 0);
  stage = "refresh";
  for (const language of messageLanguages) for (const access of [
    { permission: PermissionFlagsBits.ManageGuild }, { permission: 0n, roles: [managerRoleId] }
  ]) {
    result = await invoke(true, { language, ...access });
    assert.equal(result.sendAttempts, 0); assert.equal(result.edited.length, 1);
    assert.equal(result.edited[0].embeds[0].toJSON().description, getPlayerGuideText(language));
    assert.deepEqual(result.edited[0].allowedMentions.parse, []);
    assert.equal(result.privateReplies.length, 0); assert.equal(result.cleaned, 1);
  }
  for (const source of [
    { author: { id: "other-bot" } }, { guildId: "other-guild" }, { channelId: "other-channel" },
    { flags: { has: () => true } }, { components: [] }
  ]) {
    result = await invoke(true, { source });
    assert.equal(result.editAttempts, 0); assert.equal(result.sendAttempts, 0);
    assert.equal(result.privateReplies[0].content, message("pl", "guideUnavailable"));
  }
  result = await invoke(true, { customId: "quiz:refresh" });
  assert.equal(result.editAttempts, 0); assert.equal(result.privateReplies[0].content, message("pl", "guideUnavailable"));
  stage = "failures";
  result = await invoke(false, { failSend: true });
  assert.equal(result.sendAttempts, 1); assert.equal(result.cleaned, 0);
  assert.equal(result.privateReplies[0].content, message("pl", "guidePublishFailed"));
  result = await invoke(true, { failEdit: true });
  assert.equal(result.editAttempts, 1); assert.equal(result.cleaned, 0);
  assert.equal(result.privateReplies[0].content, message("pl", "guideRefreshFailed"));
  result = await invoke(false, { failCleanup: true });
  assert.equal(result.sent.length, 1); assert.equal(result.privateReplies[0].content, message("pl", "guidePublished"));
  console.log(JSON.stringify({ check: "guide", passed: true, locales: messageLanguages.length, publicPublishing: true, refreshInPlace: true,
    adminAndRoleAccess: true, staleTextReplaced: true, noExtraSuccessMessage: true, lengthBudget: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "guide", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-guide\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; clearGuildSettingsCache(); await db.$disconnect(); }
