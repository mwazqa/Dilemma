import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test", OPENROUTER_MODEL: "nvidia/nemotron-3-super-120b-a12b:free", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const { messages, messageLanguages, message, normalizeLanguage } = await import("../dist/messages.js");
const { getHelpContent, getHelpEmbed, handleHelp } = await import("../dist/commands/help.js");
const { difficultySchema } = await import("../dist/difficulty.js");
for (const [key, translations] of Object.entries(messages)) {
  assert.equal(translations.length, 6, key);
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const text of translations) {
    assert.ok(text.length > 0, key);
    assert.deepEqual(placeholders(text), placeholders(translations[0]), key);
    assert.ok(!text.includes("—"), key);
  }
}
// Full replies share Dilemma's warm voice. Short labels and irreversible-data
// warnings deliberately stay plain; style must not hide limits or next steps.
const friendlyFeedbackKeys = [
  "achievementFirstAnswerGoal", "achievementCorrect10Goal", "achievementAnswers100Goal", "achievementStreak10Goal",
  "achievementLevel2Goal", "achievementLevel5Goal", "achievementsSummary", "badgeSet", "badgeCleared", "badgeLocked",
  "badgeUnknown", "badgeSelectionInvalid", "pollClosing", "topicDailyLimit", "randomCooldown", "serverOnly",
  "permission", "channel", "emptyTopics", "generating", "randomDone", "timeout", "quota", "generationFailed",
  "missing", "optionsInvalid", "optionsMismatch", "optionsMissing", "saved", "deleted", "runDone", "settingsMissing",
  "timeInvalid", "configured", "languageSet", "defaultsSet", "notPoll", "pollDone", "pollFailed", "error", "ping",
  "helpIntro", "scoreEmpty", "partial"
];
const permanentDeletionWords = [/permanent/i, /trwale/i, /dauerhaft/i, /definitiv/i, /définitiv/i, /完全/];
for (const [index, language] of messageLanguages.entries()) {
  for (const key of friendlyFeedbackKeys) {
    assert.ok(message(language, key).includes("~"), `${key} keeps the shared feedback voice in ${language}`);
    assert.ok(message(language, key).length <= 2000);
  }
  for (const key of ["forgetConfirm", "scoreForgotten"]) {
    assert.doesNotMatch(message(language, key), /[~♡✧]/, "Permanent-deletion warnings are not decorated");
    assert.match(message(language, key), permanentDeletionWords[index]);
  }
  assert.ok(message(language, "forgetConfirm").includes("/dilemma score forget confirm:true"));
  for (const key of ["scoreAnswers", "scoreCorrect", "scoreStreak", "scorePoints", "scoreExpProgress", "endQuizButton", "badgeNone"]) {
    assert.doesNotMatch(message(language, key), /[~♡✧]/, "Short labels remain readable");
  }
  assert.ok(message(language, "optionsInvalid").includes("2-4") && message(language, "optionsInvalid").includes("55"));
  assert.ok(message(language, "optionsMissing").includes("options") && message(language, "optionsMissing").includes("option_count"));
  assert.ok(message(language, "timeInvalid").includes("HH:mm") && message(language, "timeInvalid").includes("18:30"));
  assert.ok(message(language, "randomCooldown").includes("2") && message(language, "randomCooldown").includes("{minutes}"));
  assert.ok(message(language, "badgeSelectionInvalid").includes("3"));
}
for (const language of messageLanguages) {
  assert.doesNotMatch(getHelpContent(language), /option_count|difficulty:|confirm:true|\/dilemma (?:rename|help)/);
  assert.match(message(language, "randomDone", { name: "Test", count: 4 }), /Test/);
  assert.ok(getHelpContent(language).length < 2000);
  const card = getHelpEmbed(language).toJSON();
  assert.equal(card.title, message(language, "helpIntro"));
  assert.equal(card.fields.length, 3);
  assert.ok(card.fields.every(field => field.value.length <= 1024));
  const commands = card.fields.map(field => field.value).join("\n");
  assert.doesNotMatch(commands, /option_count|difficulty:|confirm:true|\/dilemma (?:rename|help)/);
  for (const command of ["create", "configure", "enable", "disable", "run", "random", "list", "delete"]) {
    assert.ok(commands.includes(`/dilemma ${command}`));
  }
  assert.ok(commands.includes("/dilemma language") && commands.includes("/dilemma defaults") && commands.includes("/dilemma poll end") && commands.includes("/dilemma score"));
  assert.doesNotMatch(commands, /`\/(?:settings|help|score|poll|ping)(?: |`)/);
  for (const sub of ["profile", "leaderboard", "achievements", "badge", "forget"]) assert.ok(commands.includes(`/dilemma score ${sub}`));
}
assert.equal(normalizeLanguage("es-ES"), "es");
assert.equal(normalizeLanguage("unknown"), "en");
assert.throws(() => difficultySchema.parse("expert"));
const { db } = await import("../dist/db.js");
let settings = { guildId: "guild", language: "pl", defaultDifficulty: "hard", defaultIntervalDays: 7, defaultPollDurationHours: 24, defaultGenerationTime: null };
let topic;
let randomPoll;
let generatedPoll;
db.dailyQuizRun.findMany = async () => [];
db.dailyQuizRun.create = async ({ data }) => ({ ...data, createdAt: data.createdAt ?? new Date(), messageId: null });
db.dailyQuizRun.updateMany = async () => ({ count: 1 });
db.dailyQuizRun.update = async ({ data }) => data;
db.dailyQuizRun.deleteMany = async () => ({ count: 1 });
db.generatedPoll.count = db.randomPoll.count = async () => 0;
function resetTopicDay() { if (topic) topic.lastGeneratedAt = null; }
db.guildSettings.findUnique = async () => settings;
db.guildSettings.upsert = async ({ create, update }) => settings = { ...settings, ...(settings ? update : create) };
db.topic.findUnique = async () => topic ?? null;
db.topic.findMany = async () => topic ? [topic] : [];
db.topic.upsert = async ({ create, update }) => topic = topic ? { ...topic, ...update } : { id: "topic", enabled: true, generationTime: null, questionsGenerated: 0, ...create };
db.topic.update = async ({ data }) => {
  topic = { ...topic, ...data, questionsGenerated: data.questionsGenerated?.increment ? topic.questionsGenerated + data.questionsGenerated.increment : topic.questionsGenerated };
  return topic;
};
db.randomPoll.findMany = async () => [];
db.randomPoll.findFirst = async () => null;
db.randomPoll.create = async ({ data }) => randomPoll = data;
db.generatedPoll.findMany = async () => [];
db.generatedPoll.create = async ({ data }) => generatedPoll = data;
db.quizSettlement.create = async ({ data }) => data;
db.$transaction = async callback => callback(db);
let lastPrompt;
let counter = 0;
globalThis.fetch = async (_, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.messages[0].role, "system");
  assert.ok(body.messages[0].content.includes(`(${settings.language})`));
  lastPrompt = body.messages[1].content;
  assert.equal(body.reasoning.enabled, false);
  const q = { language: settings.language, topic: "Test", question: `Pytanie ${++counter}?`, options: ["A", "B", "C", "D"], topicEmoji: "", optionEmojis: ["", "", "", ""], correctOption: 0, explanation: "Fakt." };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(q) } }] }), { headers: { "content-type": "application/json" } });
};
const { handleTopic, handleTopicAutocomplete } = await import("../dist/commands/topic.js");
const { dilemmaCommand, routeCommand } = await import("../dist/commands/dilemma.js");
function checkNativeDescriptions(option) {
  if (option.description) assert.doesNotMatch(option.description, /[~♡✧]/, "Discord menu descriptions stay neutral");
  for (const child of option.options ?? []) checkNativeDescriptions(child);
}
checkNativeDescriptions(dilemmaCommand.toJSON());
assert.deepEqual(dilemmaCommand.toJSON().options.map(sub => sub.name).sort(),
  ["create", "configure", "enable", "disable", "delete", "list", "help", "random", "run", "language", "defaults", "ping", "score", "poll"].sort());
assert.ok(dilemmaCommand.toJSON().options.every(sub => !sub.options?.some(option => ["old_name", "new_name"].includes(option.name))));
for (const language of messageLanguages) {
  const content = getHelpContent(language);
  const fields = getHelpEmbed(language).toJSON().fields.map(field => field.value).join("\n");
  for (const sub of dilemmaCommand.toJSON().options) {
    if (sub.name === "help") continue; // Keep the command, but do not advertise help inside itself.
    const paths = sub.type === 2 ? sub.options.map(child => `/dilemma ${sub.name} ${child.name}`) : [`/dilemma ${sub.name}`];
    for (const path of paths) {
      assert.ok(content.includes(`\`${path}\``), `Text help covers ${path} in ${language}`);
      assert.ok(fields.includes(`\`${path}\``), `Help card covers ${path} in ${language}`);
    }
  }
  for (const match of fields.matchAll(/`(\/[^`]+)`/g)) assert.ok(match[1].startsWith("/dilemma "));
  assert.ok(message(language, "forgetConfirm").includes("/dilemma score forget confirm:true"));
}
const { handleSettings } = await import("../dist/commands/settings.js");
const { publishTopicQuestions } = await import("../dist/services/poll-publisher.js");
const { DailyQuizLimitError, RandomQuizCooldownError } = await import("../dist/services/quiz-limits.js");
const { handlePing } = await import("../dist/commands/ping.js");
let sent;
const channel = { id: "channel", isSendable: () => true, send: async payload => {
  assert.equal(payload.components[0].toJSON().components[0].custom_id, "quiz:end");
  assert.equal(payload.components[0].toJSON().components[0].disabled, false);
  assert.equal(payload.flags, undefined, "Polls use classic components, not Components V2");
  sent = payload; return { id: `message-${counter}`, channelId: "channel", poll: { allowMultiselect: false, expiresAt: new Date(Date.now() + 86400000), answers: new Map(payload.poll.answers.map((answer, i) => [7 + i * 3, { id: 7 + i * 3, text: answer.text }])) } }; } };
function interaction(subcommand, values = {}, permitted = true) {
  const replies = [];
  let acknowledged = false;
  return { commandName: "dilemma", guildId: "guild", locale: "en-US", channel, channelId: "channel", memberPermissions: { has: () => permitted },
    options: { getSubcommandGroup: () => null, getSubcommand: () => subcommand, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
    deferReply: async () => { acknowledged = true; },
    editReply: async payload => { assert.ok(acknowledged); replies.push(payload.content ?? payload); }, replies };
}
const help = interaction("help"); await handleHelp(help);
assert.equal(help.replies[0].content, null);
assert.deepEqual(help.replies[0].embeds[0].toJSON(), getHelpEmbed("pl").toJSON());
assert.deepEqual(help.replies[0].allowedMentions.parse, []);
const topicHelp = interaction("help"); await handleTopic(topicHelp);
assert.equal(topicHelp.replies[0].content, null);
assert.deepEqual(topicHelp.replies[0].embeds[0].toJSON(), getHelpEmbed("pl").toJSON());
const retiredRename = interaction("rename", { old_name: "Old", new_name: "New", name: "Test" });
retiredRename.options.getString = () => { throw new Error("Retired commands must not read topic options"); };
await handleTopic(retiredRename);
assert.deepEqual(retiredRename.replies[0].embeds[0].toJSON(), getHelpEmbed("pl").toJSON());
const findTopics = db.topic.findMany;
try {
  db.topic.findMany = async () => { throw new Error("Retired autocomplete must not query topics"); };
  await handleTopicAutocomplete({ guildId: "guild", options: { getFocused: () => ({ name: "old_name", value: "Old" }) },
    respond: async choices => assert.deepEqual(choices, []) });
} finally { db.topic.findMany = findTopics; }
for (const level of ["easy", "medium", "hard"]) {
  const command = interaction("random", { option_count: 4, difficulty: level });
  await handleTopic(command);
  assert.match(lastPrompt, new RegExp(`Difficulty: ${level}`));
  assert.equal(randomPoll.difficulty, level);
  assert.match(sent.content, new RegExp(message("pl", level)));
  assert.match(command.replies.at(-1), /Quiz gotowy/);
}
await handleTopic(interaction("random", { option_count: 4 }));
assert.equal(randomPoll.difficulty, "hard");
await handleTopic(interaction("create", { name: "Test", option_count: 4 }));
assert.equal(topic.difficulty, "hard");
assert.equal(topic.generationTime, null, "No schedule is enabled until a default time is chosen");
const originalInterval = topic.intervalDays;
topic.lastGeneratedAt = new Date();
const lastRun = topic.lastGeneratedAt;
await handleTopic(interaction("configure", { name: "Test", generation_time: "18:00", duration_hours: 3 }));
assert.equal(topic.lastGeneratedAt, lastRun, "Schedule changes never reset the last run");
assert.equal(topic.pollDurationHours, 3);
resetTopicDay();
await handleTopic(interaction("configure", { name: "Test", difficulty: "easy" }));
assert.equal(topic.difficulty, "easy");
assert.equal(topic.intervalDays, originalInterval);
await handleTopic(interaction("create", { name: "Test", option_count: 4 }));
assert.equal(topic.difficulty, "easy", "Updating topic without difficulty preserves selection");
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, /Difficulty: easy/);
assert.equal(generatedPoll.difficulty, "easy");
resetTopicDay();
await handleTopic(interaction("run", { name: "Test" }));
assert.equal(generatedPoll.difficulty, "easy");
const denied = interaction("random", { option_count: 4 }, false);
const requestsBefore = counter;
await handleTopic(denied);
assert.equal(counter, requestsBefore);
assert.match(denied.replies[0], /Zarządzanie serwerem/);
const invalid = interaction("create", { name: "Test", options: "A,A" });
await handleTopic(invalid);
assert.match(invalid.replies[0], /różne odpowiedzi/);
await handleSettings(interaction("defaults", { interval_days: 3, duration_hours: 2, difficulty: "medium" }));
assert.equal(settings.defaultPollDurationHours, 2);
assert.equal(settings.defaultDifficulty, "medium");
assert.equal(topic.difficulty, "easy", "Server defaults do not overwrite existing topics");
await handleSettings(interaction("defaults", { interval_days: 4 }));
assert.equal(settings.defaultPollDurationHours, 2);
assert.equal(settings.defaultDifficulty, "medium");
const defaultsOption = dilemmaCommand.toJSON().options.find(sub => sub.name === "defaults");
const generationOption = defaultsOption.options.find(option => option.name === "generation_hours");
assert.equal(generationOption.type, 3, "Publication time is a string, not an hourly interval");
assert.equal(generationOption.min_length, 5);
assert.equal(generationOption.max_length, 5);
assert.ok(defaultsOption.options.every(option => !option.required), "Allow changing the publication time alone");
const { isGenerationTime, isTopicDue } = await import("../dist/services/quiz-limits.js");
for (const time of ["00:00", "18:30", "23:59"]) assert.equal(isGenerationTime(time), true);
for (const time of ["", " ", "9:00", "24:00", "18:60", "-1:00", "18.30", "18:30:00"]) {
  assert.equal(isGenerationTime(time), false);
  const before = { ...settings };
  const invalidTime = interaction("defaults", { generation_hours: time });
  await routeCommand(invalidTime);
  assert.equal(invalidTime.replies[0], message("pl", "timeInvalid"));
  assert.deepEqual(settings, before, "Invalid hours must not write settings");
}
const beforeEmpty = { ...settings };
const emptyDefaults = interaction("defaults");
await routeCommand(emptyDefaults);
assert.equal(emptyDefaults.replies[0], message("pl", "settingsMissing"));
assert.deepEqual(settings, beforeEmpty);
const beforeSchedule = { ...topic };
const setTime = interaction("defaults", { generation_hours: "18:30" });
await routeCommand(setTime);
assert.equal(settings.defaultGenerationTime, "18:30");
assert.equal(settings.defaultIntervalDays, 4);
assert.equal(settings.defaultPollDurationHours, 2);
assert.equal(settings.defaultDifficulty, "medium");
assert.ok(setTime.replies[0].includes("18:30") && setTime.replies[0].includes("Europe/Warsaw"));
assert.deepEqual(topic, beforeSchedule, "Defaults must not update existing schedules or last run");
await routeCommand(interaction("create", { name: "Test", option_count: 4 }));
assert.equal(topic.generationTime, "18:00", "Updating an existing topic preserves its explicit time");
const existingTopic = topic;
topic = undefined;
await routeCommand(interaction("create", { name: "Scheduled", option_count: 4 }));
assert.equal(topic.generationTime, "18:30", "A new topic inherits the default publication time");
assert.equal(topic.intervalDays, 4);
assert.equal(isTopicDue(topic, new Date("2026-10-12T16:29:00Z")), false);
assert.equal(isTopicDue(topic, new Date("2026-10-12T16:30:00Z")), true);
await routeCommand(interaction("configure", { name: "Scheduled", generation_time: "19:45" }));
assert.equal(topic.generationTime, "19:45", "Per-topic time can override the inherited default");
assert.equal(settings.defaultGenerationTime, "18:30");
topic = existingTopic;
await routeCommand(interaction("defaults", { duration_hours: 3 }));
assert.equal(settings.defaultGenerationTime, "18:30", "Omitting the time preserves the saved default");
for (const language of messageLanguages) {
  assert.ok(message(language, "defaultsSet", { days: 1, hours: 24, difficulty: "Easy", time: "18:30", timezone: "Europe/Warsaw" }).includes("18:30"));
}
await handleSettings(interaction("language", { value: "ja" }));
topic.language = "en";
const savedDuration = topic.pollDurationHours;
const savedDifficulty = topic.difficulty;
resetTopicDay();
await handleTopic(interaction("run", { name: "Test" }));
assert.match(lastPrompt, / in ja\./, "Run uses global language, not stale topic language");
assert.match(sent.content, new RegExp(message("ja", "difficulty", { difficulty: message("ja", savedDifficulty) })));
resetTopicDay();
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, / in ja\./, "Scheduled publisher uses global language");
assert.equal(topic.pollDurationHours, savedDuration);
assert.equal(topic.difficulty, savedDifficulty);
const createRun = db.dailyQuizRun.create;
const updateRuns = db.dailyQuizRun.updateMany;
db.dailyQuizRun.updateMany = async () => { throw new RandomQuizCooldownError(new Date(Date.now() + 120 * 60_000)); };
const randomLimited = interaction("random", { option_count: 4 });
const callsAtLimit = counter;
await handleTopic(randomLimited);
assert.match(randomLimited.replies.at(-1), /120/);
db.dailyQuizRun.updateMany = updateRuns;
resetTopicDay();
db.dailyQuizRun.create = async () => { throw new DailyQuizLimitError("topic"); };
const topicLimited = interaction("run", { name: "Test" });
await handleTopic(topicLimited);
assert.match(topicLimited.replies.at(-1), /明日/);
assert.equal(counter, callsAtLimit);
db.dailyQuizRun.create = createRun;
await handleTopic(interaction("random", { option_count: 4 }));
assert.match(lastPrompt, / in ja\./, "Random uses global language");
await handleSettings(interaction("language", { value: "pl" }));
resetTopicDay();
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, / in pl\./, "Changing global language takes effect without recreating topic");
await handleSettings(interaction("language", { value: "ja" }));
const ping = interaction("ping");
await handlePing(ping);
assert.match(ping.replies[0], /ここにいる/);
for (const command of [dilemmaCommand.toJSON()]) {
  for (const sub of command.options) {
    assert.ok(!sub.options?.some(option => option.name === "questions_per_run"));
    const duration = sub.options?.find(option => option.name === "duration_hours");
    if (duration) { assert.equal(duration.min_value, 1); assert.equal(duration.max_value, 24); }
  }
  for (const sub of command.options.filter(sub => ["create", "configure", "random", "defaults"].includes(sub.name))) {
    const option = sub.options.find(option => option.name === "difficulty");
    assert.deepEqual(option.choices.map(choice => choice.value), ["easy", "medium", "hard"]);
    assert.ok(!option.required);
  }
}
assert.equal(dilemmaCommand.toJSON().default_member_permissions, undefined, "The root must remain available to ordinary players");
const routedHelp = interaction("help", {}, false);
await routeCommand(routedHelp);
assert.deepEqual(routedHelp.replies[0].embeds[0].toJSON(), getHelpEmbed("ja").toJSON());
const routedPing = interaction("ping", {}, false);
await routeCommand(routedPing);
assert.equal(routedPing.replies[0], message("ja", "ping"));
for (const sub of ["language", "defaults", "create", "configure", "enable", "disable", "delete", "run", "random", "list"]) {
  const deniedRoute = interaction(sub, { value: "en", name: "Test" }, false);
  const topicBefore = { ...topic };
  const settingsBefore = { ...settings };
  await routeCommand(deniedRoute);
  assert.equal(deniedRoute.replies[0], message("ja", "permission"));
  assert.deepEqual(topic, topicBefore);
  assert.deepEqual(settings, settingsBefore);
}
await routeCommand(interaction("language", { value: "pl" }));
assert.equal(settings.language, "pl");
await routeCommand(interaction("defaults", { interval_days: 5, duration_hours: 4 }));
assert.equal(settings.defaultIntervalDays, 5);
assert.equal(settings.defaultPollDurationHours, 4);
const routedList = interaction("list");
await routeCommand(routedList);
assert.ok(routedList.replies[0].includes("Test"));
for (const name of ["settings", "language", "help", "ping", "score", "poll"]) {
  const legacy = interaction("help");
  legacy.commandName = name;
  await routeCommand(legacy);
  assert.equal(legacy.replies.length, 0, "No legacy top-level aliases");
}
const establishedSettings = settings;
settings = undefined;
const firstDefaults = interaction("defaults", { generation_hours: "00:00" });
await routeCommand(firstDefaults);
assert.equal(settings.defaultGenerationTime, "00:00", "A new server can set the time without an interval");
assert.equal(settings.defaultIntervalDays, 1);
assert.equal(settings.defaultPollDurationHours, 24);
assert.equal(settings.defaultDifficulty, "medium");
settings = establishedSettings;
await db.$disconnect();
console.log("PASS: six-locale help without a self-entry, default publication times, inheritance, timezone, partial updates, preserved schedules and permissions");
