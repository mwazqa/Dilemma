import assert from "node:assert/strict";
Object.assign(process.env, { DOTENV_CONFIG_PATH: ".tools/disabled-language-tests.env", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test",
  DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { MessageFlags } = await import("discord.js");
const { message, messages, messageLanguages } = await import("../dist/messages.js");
const { normalizeLanguage, languageNames } = await import("../dist/languages.js");
const { supportedLanguages, languageCommand, handleSettings } = await import("../dist/commands/settings.js");
const { difficultyOption } = await import("../dist/difficulty.js");
const { SlashCommandStringOption } = await import("discord.js");
const { getVotePrompt, getResultMessage } = await import("../dist/brand.js");
const { getGuildSettings, cacheGuildSettings, clearGuildSettingsCache } = await import("../dist/services/guild-settings.js");
let stage = "catalog", reads = 0, writes = 0;
let stored = { guildId: "language-test", language: "ja", managerRoleId: null };
db.guildSettings.findUnique = async () => { reads++; return { ...stored }; };
db.guildSettings.upsert = async ({ update }) => { writes++; stored = { ...stored, ...update }; return { ...stored }; };
const invoke = async value => {
  const replies = [];
  await handleSettings({ guildId: stored.guildId, locale: "pl", memberPermissions: { has: () => true },
    options: { getSubcommand: () => "language", getString: () => value },
    deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload); } });
  return replies.at(-1);
};
try {
  assert.deepEqual(messageLanguages, ["en", "pl"]);
  assert.deepEqual(languageCommand.toJSON().options[0].choices.map(({ name, value }) => ({ name, value })), supportedLanguages);
  assert.deepEqual(supportedLanguages.map(item => item.value), messageLanguages);
  const difficulty = difficultyOption(new SlashCommandStringOption()).toJSON();
  assert.ok(difficulty.choices.every(choice => Object.keys(choice.name_localizations).join() === "pl"));
  for (const translations of Object.values(messages)) assert.equal(translations.length, 2);
  assert.equal(message("pl", "myQuizVoteButton"), "Moja odpowiedź");
  for (const [value, expected] of [["pl", "pl"], ["PL-pl", "pl"], [" pl_PL ", "pl"], ["en-GB", "en"], ["en-US", "en"]]) {
    assert.equal(normalizeLanguage(value), expected);
    assert.ok(languageNames[expected]);
  }
  stage = "legacy-fallback";
  for (const value of ["de", "de-DE", "es-ES", "fr-FR", "ja", "ja-JP", "ko-KR", "zh-CN", "unknown"]) {
    assert.equal(normalizeLanguage(value), "en");
    assert.equal(message(value, "voteSaved", { answer: 2 }), message("en", "voteSaved", { answer: 2 }));
    assert.equal(getVotePrompt(value), getVotePrompt("en"));
    assert.equal(getResultMessage(value, "Answer", "Fact", ""), getResultMessage("en", "Answer", "Fact", ""));
  }
  clearGuildSettingsCache();
  assert.equal((await getGuildSettings(stored.guildId)).language, "en");
  assert.equal(stored.language, "ja", "Reading legacy settings never rewrites stored history");
  const readsAfterFirst = reads;
  assert.equal((await getGuildSettings(stored.guildId)).language, "en");
  assert.equal(reads, readsAfterFirst, "Fallback keeps the existing cache behavior");
  assert.equal(cacheGuildSettings({ ...stored, language: "fr" }).language, "en");
  stage = "stale-language-selection";
  for (const value of ["de", "es", "fr", "ja", "ko", "zh", "en-US", "unknown"]) {
    const reply = await invoke(value);
    assert.equal(reply.content, message("en", "languageUnavailable"));
    assert.equal(writes, 0, "Unsupported selections never write settings");
    assert.equal(stored.language, "ja");
  }
  stage = "supported-language-selection";
  for (const language of ["pl", "en"]) {
    const reply = await invoke(language);
    assert.equal(stored.language, language);
    assert.equal((await getGuildSettings(stored.guildId)).language, language);
    assert.ok(reply.content.includes(supportedLanguages.find(item => item.value === language).name));
  }
  assert.equal(writes, 2);
  console.log(JSON.stringify({ check: "languages", passed: true, locales: messageLanguages.length, legacyFallback: true, staleSelectionsRejected: true, historyPreserved: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "languages", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-languages\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { clearGuildSettingsCache(); await db.$disconnect(); }
