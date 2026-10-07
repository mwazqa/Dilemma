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
for (const language of messageLanguages) {
  assert.doesNotMatch(getHelpContent(language), /option_count|difficulty:|confirm:true/);
  assert.match(message(language, "randomDone", { name: "Test", count: 4 }), /Test/);
  assert.ok(getHelpContent(language).length < 2000);
  const card = getHelpEmbed(language).toJSON();
  assert.equal(card.title, message(language, "helpIntro"));
  assert.equal(card.fields.length, 3);
  assert.ok(card.fields.every(field => field.value.length <= 1024));
  const commands = card.fields.map(field => field.value).join("\n");
  assert.doesNotMatch(commands, /option_count|difficulty:|confirm:true/);
  for (const command of ["create", "configure", "enable", "disable", "run", "random", "list", "rename", "delete"]) {
    assert.ok(commands.includes(`/dilemma ${command}`));
  }
  assert.ok(commands.includes("/settings") && commands.includes("/poll end") && commands.includes("/score"));
}
assert.equal(normalizeLanguage("es-ES"), "es");
assert.equal(normalizeLanguage("unknown"), "en");
assert.throws(() => difficultySchema.parse("expert"));
const { db } = await import("../dist/db.js");
let settings = { guildId: "guild", language: "pl", defaultDifficulty: "hard", defaultIntervalDays: 7, defaultPollDurationHours: 24 };
let topic;
let randomPoll;
let generatedPoll;
db.dailyQuizRun.findMany = async () => [];
db.dailyQuizRun.create = async ({ data }) => data;
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
db.randomPoll.create = async ({ data }) => randomPoll = data;
db.generatedPoll.findMany = async () => [];
db.generatedPoll.create = async ({ data }) => generatedPoll = data;
db.quizSettlement.create = async ({ data }) => data;
db.$transaction = async callback => callback(db);
let lastPrompt;
let counter = 0;
globalThis.fetch = async (_, options) => {
  const body = JSON.parse(options.body);
  lastPrompt = body.messages[0].content;
  assert.equal(body.reasoning.enabled, false);
  const q = { language: "pl", topic: "Test", question: `Pytanie ${++counter}?`, options: ["A", "B", "C", "D"], topicEmoji: "", optionEmojis: ["", "", "", ""], correctOption: 0, explanation: "Fakt." };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(q) } }] }), { headers: { "content-type": "application/json" } });
};
const { handleTopic, dilemmaCommand } = await import("../dist/commands/topic.js");
const { handleSettings, settingsCommand } = await import("../dist/commands/settings.js");
const { publishTopicQuestions } = await import("../dist/services/poll-publisher.js");
const { DailyQuizLimitError } = await import("../dist/services/quiz-limits.js");
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
  return { guildId: "guild", locale: "en-US", channel, channelId: "channel", memberPermissions: { has: () => permitted },
    options: { getSubcommand: () => subcommand, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
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
db.dailyQuizRun.create = async () => { throw new DailyQuizLimitError("random"); };
const randomLimited = interaction("random", { option_count: 4 });
const callsAtLimit = counter;
await handleTopic(randomLimited);
assert.match(randomLimited.replies.at(-1), /3/);
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
for (const command of [dilemmaCommand.toJSON(), settingsCommand.toJSON()]) {
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
await db.$disconnect();
console.log("PASS: six locales, feedback, difficulty, global language, preserved settings, permissions and validation");
