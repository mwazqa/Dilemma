import assert from "node:assert/strict";
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test", OPENROUTER_MODEL: "nvidia/nemotron-3-super-120b-a12b:free", AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "0" });
const { messages, messageLanguages, message, normalizeLanguage } = await import("../dist/messages.js");
const { getHelpContent } = await import("../dist/commands/help.js");
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
  assert.match(getHelpContent(language), /difficulty:easy\/medium\/hard/);
  assert.match(message(language, "randomDone", { name: "Test", count: 4 }), /Test/);
  assert.ok(getHelpContent(language).length < 2000);
}
assert.equal(normalizeLanguage("es-ES"), "es");
assert.equal(normalizeLanguage("unknown"), "en");
assert.throws(() => difficultySchema.parse("expert"));
const { db } = await import("../dist/db.js");
let settings = { guildId: "guild", language: "pl", defaultDifficulty: "hard", defaultIntervalDays: 7, defaultQuestionsPerRun: 1 };
let topic;
let randomPoll;
let generatedPoll;
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
const { handlePing } = await import("../dist/commands/ping.js");
let sent;
const channel = { id: "channel", isSendable: () => true, send: async payload => { sent = payload; return { id: `message-${counter}`, channelId: "channel", poll: { allowMultiselect: false, expiresAt: new Date(Date.now() + 86400000), answers: new Map(payload.poll.answers.map((answer, i) => [7 + i * 3, { id: 7 + i * 3, text: answer.text }])) } }; } };
function interaction(subcommand, values = {}, permitted = true) {
  const replies = [];
  let acknowledged = false;
  return { guildId: "guild", locale: "en-US", channel, channelId: "channel", memberPermissions: { has: () => permitted },
    options: { getSubcommand: () => subcommand, getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
    deferReply: async () => { acknowledged = true; },
    editReply: async payload => { assert.ok(acknowledged); replies.push(payload.content ?? payload); }, replies };
}
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
await handleTopic(interaction("configure", { name: "Test", difficulty: "easy" }));
assert.equal(topic.difficulty, "easy");
assert.equal(topic.intervalDays, originalInterval);
await handleTopic(interaction("create", { name: "Test", option_count: 4 }));
assert.equal(topic.difficulty, "easy", "Updating topic without difficulty preserves selection");
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, /Difficulty: easy/);
assert.equal(generatedPoll.difficulty, "easy");
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
await handleSettings(interaction("defaults", { interval_days: 3, questions_per_run: 2, difficulty: "medium" }));
assert.equal(settings.defaultDifficulty, "medium");
assert.equal(topic.difficulty, "easy", "Server defaults do not overwrite existing topics");
await handleSettings(interaction("defaults", { interval_days: 4, questions_per_run: 1 }));
assert.equal(settings.defaultDifficulty, "medium");
await handleSettings(interaction("language", { value: "ja" }));
topic.language = "en";
const savedCount = topic.questionsPerRun;
const savedDifficulty = topic.difficulty;
await handleTopic(interaction("run", { name: "Test" }));
assert.match(lastPrompt, / in ja\./, "Run uses global language, not stale topic language");
assert.match(sent.content, new RegExp(message("ja", "difficulty", { difficulty: message("ja", savedDifficulty) })));
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, / in ja\./, "Scheduled publisher uses global language");
assert.equal(topic.questionsPerRun, savedCount);
assert.equal(topic.difficulty, savedDifficulty);
await handleTopic(interaction("random", { option_count: 4 }));
assert.match(lastPrompt, / in ja\./, "Random uses global language");
await handleSettings(interaction("language", { value: "pl" }));
await publishTopicQuestions(topic, channel);
assert.match(lastPrompt, / in pl\./, "Changing global language takes effect without recreating topic");
await handleSettings(interaction("language", { value: "ja" }));
const ping = interaction("ping");
await handlePing(ping);
assert.match(ping.replies[0], /ここにいる/);
for (const command of [dilemmaCommand.toJSON(), settingsCommand.toJSON()]) {
  for (const sub of command.options.filter(sub => ["create", "configure", "random", "defaults"].includes(sub.name))) {
    const option = sub.options.find(option => option.name === "difficulty");
    assert.deepEqual(option.choices.map(choice => choice.value), ["easy", "medium", "hard"]);
    assert.ok(!option.required);
  }
}
await db.$disconnect();
console.log("PASS: six locales, feedback, difficulty, global language, preserved settings, permissions and validation");
