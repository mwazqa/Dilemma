import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture" });
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request in management test"); };
const { PermissionFlagsBits, PermissionsBitField } = await import("discord.js");
const { db } = await import("../dist/db.js");
const { canConfigureManagement, canManageDilemma } = await import("../dist/services/management-permissions.js");
const { clearGuildSettingsCache, getGuildSettings } = await import("../dist/services/guild-settings.js");
const { routeCommand, dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { handleTopicAutocomplete } = await import("../dist/commands/topic.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { getHelpEmbed, getHelpContent } = await import("../dist/commands/help.js");
const roleId = "111111111111111111", otherRoleId = "222222222222222222";
const settings = new Map();
const roles = new Map();
let writes = 0, reads = 0, topicReads = 0, topicWrites = 0;
const baseSettings = guildId => ({ guildId, language: "pl", managerRoleId: null, defaultIntervalDays: 7,
  defaultGenerationTime: "18:30", defaultPollDurationHours: 3, defaultDifficulty: "hard" });
settings.set("guild", baseSettings("guild"));
settings.set("other", baseSettings("other"));
db.guildSettings.findUnique = async ({ where }) => { reads++; return settings.get(where.guildId) ?? null; };
db.guildSettings.upsert = async ({ where, create, update }) => {
  writes++;
  const row = { ...(settings.get(where.guildId) ?? { ...baseSettings(where.guildId), ...create }), ...update };
  settings.set(where.guildId, row); return row;
};
db.topic.findMany = async ({ where }) => { topicReads++; return [{ id: "topic", guildId: where.guildId, name: "Fixture",
  difficulty: "medium", intervalDays: 1, pollDurationHours: 2, enabled: true, options: "", optionCount: 4, generationTime: null }]; };
db.topic.findUnique = async () => null;
db.topic.create = async ({ data }) => { topicWrites++; return { id: "created", enabled: true, ...data }; };
function interaction(action, { permission = 0n, memberRoles = [], guildId = "guild", group = "permissions", values = {}, selected } = {}) {
  const replies = [];
  return { commandName: "dilemma", guildId, locale: "pl", member: { roles: memberRoles },
    memberPermissions: new PermissionsBitField(permission), channelId: "channel",
    guild: guildId ? { id: guildId, roles: { fetch: async id => roles.get(id) ?? null } } : null,
    options: { getSubcommandGroup: () => group, getSubcommand: () => action,
      getString: name => values[name] ?? null, getInteger: name => values[name] ?? null,
      getRole: () => selected ?? { id: roleId, managed: false } },
    deferReply: async () => {}, editReply: async payload => {
      assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload);
    }, replies };
}
const invoke = async (action, options) => { const request = interaction(action, options); await routeCommand(request); return request; };
const content = request => request.replies.at(-1)?.content;
const delegated = { memberRoles: [roleId] };
const admin = { permission: PermissionFlagsBits.ManageGuild };
try {
  clearGuildSettingsCache();
  const bound = { ...baseSettings("guild"), managerRoleId: roleId };
  assert.equal(canManageDilemma(interaction("show", delegated), bound), true);
  assert.equal(canConfigureManagement(interaction("set", delegated)), false);
  assert.equal(canManageDilemma(interaction("show"), bound), false);
  assert.equal(canManageDilemma(interaction("show", { memberRoles: [otherRoleId] }), bound), false);
  assert.equal(canManageDilemma(interaction("show", delegated), { ...bound, guildId: "other" }), false);
  assert.equal(canManageDilemma(interaction("show", { ...delegated, guildId: null }), bound), false);
  assert.equal(canManageDilemma(interaction("show", { memberRoles: ["guild"] }), { ...bound, managerRoleId: "guild" }), false);
  for (const permission of [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
    assert.equal(canManageDilemma(interaction("show", { permission }), null), true);
    assert.equal(canConfigureManagement(interaction("set", { permission })), true);
  }
  const cachedMember = interaction("show");
  cachedMember.member = { guild: { id: "guild" }, roles: { cache: new Map([[roleId, { name: "Any name" }]]) } };
  assert.equal(canManageDilemma(cachedMember, bound), true);
  cachedMember.member.guild.id = "other";
  assert.equal(canManageDilemma(cachedMember, bound), false);
  const missingMember = interaction("show"); missingMember.member = null;
  assert.equal(canManageDilemma(missingMember, bound), false);
  const missingRoles = interaction("show"); missingRoles.member = {};
  assert.equal(canManageDilemma(missingRoles, bound), false);
  assert.equal(content(await invoke("show", admin)), message("pl", "managerRoleUnset"));
  for (const action of ["set", "clear"]) {
    const before = writes;
    assert.equal(content(await invoke(action)), message("pl", "managementAdminOnly"));
    assert.equal(writes, before);
  }
  const original = { ...settings.get("guild") };
  roles.set(roleId, { id: roleId, guild: { id: "guild" }, managed: false, name: "Dowolna nazwa" });
  assert.equal(content(await invoke("set", admin)), message("pl", "managerRoleSet", { role: `<@&${roleId}>` }));
  assert.deepEqual(settings.get("guild"), { ...original, managerRoleId: roleId });
  assert.equal((await getGuildSettings("guild")).managerRoleId, roleId);
  assert.equal(content(await invoke("show", delegated)), message("pl", "managerRoleCurrent", { role: `<@&${roleId}>` }));
  assert.equal(content(await invoke("show", { ...delegated, guildId: "other" })), message("pl", "permission"));
  for (const action of ["set", "clear"]) {
    const before = writes;
    assert.equal(content(await invoke(action, delegated)), message("pl", "managementAdminOnly"));
    assert.equal(writes, before, "A delegated manager cannot change the delegation");
  }
  let beforeTopics = topicReads;
  await invoke("list", { ...delegated, group: null });
  assert.equal(topicReads, beforeTopics + 1);
  const beforeCreate = topicWrites;
  const created = await invoke("create", { ...delegated, group: null, values: { name: "New" } });
  assert.notEqual(content(created), message("pl", "permission"));
  assert.equal(topicWrites, beforeCreate + 1);
  for (const action of ["configure", "run", "enable", "disable", "delete"]) {
    const request = await invoke(action, { ...delegated, group: null, values: { name: "Missing" } });
    assert.equal(content(request), message("pl", "missing", { name: "Missing" }));
  }
  await invoke("language", { ...delegated, group: null, values: { value: "pl" } });
  assert.equal(settings.get("guild").language, "pl");
  const beforeTimezone = writes;
  await invoke("timezone", { ...delegated, group: null, values: { value: "Europe/London" } });
  assert.equal(writes, beforeTimezone + 1);
  assert.equal(settings.get("guild").timezone, "Europe/London");
  assert.equal(settings.get("guild").defaultPollDurationHours, original.defaultPollDurationHours);
  assert.equal(settings.get("guild").managerRoleId, roleId);
  for (const action of ["create", "configure", "list", "run", "enable", "disable", "delete", "language", "timezone"]) {
    const before = { writes, topicReads, topicWrites };
    assert.equal(content(await invoke(action, { group: null, values: { name: "New" } })), message("pl", "permission"));
    assert.deepEqual({ writes, topicReads, topicWrites }, before);
  }
  for (const allowed of [true, false]) {
    const before = topicReads;
    const request = interaction("configure", allowed ? delegated : {});
    request.options.getFocused = () => ({ name: "name", value: "" });
    request.respond = async choices => assert.equal(choices.length, allowed ? 1 : 0);
    await handleTopicAutocomplete(request);
    assert.equal(topicReads, before + (allowed ? 1 : 0));
  }
  beforeTopics = topicReads;
  const removedMember = await invoke("list", { group: null, memberRoles: [] });
  assert.equal(content(removedMember), message("pl", "permission"));
  assert.equal(topicReads, beforeTopics, "Removing a member role revokes access without a cache refresh");
  for (const invalid of [{ id: "guild", managed: false }, { id: roleId, managed: true }, { id: "deleted", managed: false }]) {
    const before = writes;
    assert.equal(content(await invoke("set", { ...admin, selected: invalid })), message("pl", "managerRoleInvalid"));
    assert.equal(writes, before);
  }
  roles.set(otherRoleId, { id: otherRoleId, managed: false, guild: { id: "other" } });
  const beforeForeign = writes;
  assert.equal(content(await invoke("set", { ...admin, selected: { id: otherRoleId, managed: false } })), message("pl", "managerRoleInvalid"));
  assert.equal(writes, beforeForeign);
  const failedLookup = interaction("set", admin);
  failedLookup.guild.roles.fetch = async () => { throw new Error("Fixture private lookup failure"); };
  await routeCommand(failedLookup);
  assert.equal(content(failedLookup), message("pl", "managerRoleInvalid"));
  assert.equal(writes, beforeForeign);
  assert.equal(content(await invoke("clear", admin)), message("pl", "managerRoleCleared"));
  assert.equal((await getGuildSettings("guild")).managerRoleId, null);
  assert.equal(content(await invoke("list", { ...delegated, group: null })), message("pl", "permission"));
  assert.notEqual(content(await invoke("list", { ...admin, group: null })), message("pl", "permission"));
  assert.equal(content(await invoke("set", { ...admin, guildId: null })), message("pl", "serverOnly"));
  const beforeCached = reads;
  await invoke("show", admin); await invoke("show", admin);
  assert.equal(reads, beforeCached, "Authorization reuses settings without another database query");
  for (const language of messageLanguages) {
    const help = getHelpEmbed(language).toJSON();
    for (const action of ["show", "set", "clear"]) assert.ok(getHelpContent(language).includes(`/dilemma permissions ${action}`));
    assert.ok(help.fields.every(field => field.value.length <= 1024));
    for (const key of ["managementAdminOnly", "managerRoleSet", "managerRoleCleared", "managerRoleCurrent", "managerRoleUnset", "managerRoleInvalid"]) {
      assert.ok(message(language, key).includes("~"));
    }
  }
  const root = dilemmaCommand.toJSON();
  assert.equal(root.default_member_permissions, undefined);
  const menu = root.options.find(option => option.name === "permissions");
  assert.equal(menu.options.find(option => option.name === "set").options[0].type, 8);
  assert.equal(menu.options.find(option => option.name === "set").options[0].required, true);
  console.log(JSON.stringify({ check: "management-permissions", passed: true, delegatedManagement: true,
    noServerPermissionsGranted: true, administratorOnlyConfiguration: true, crossServerIsolation: true,
    immediateRevocation: true, noRoleNameTrust: true, invalidRolesRejected: true, cachedAuthorization: true,
    autocompleteProtected: true, sixLanguageHelp: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "management-permissions", passed: false,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-management-permissions\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { clearGuildSettingsCache(); globalThis.fetch = realFetch; await db.$disconnect(); }
