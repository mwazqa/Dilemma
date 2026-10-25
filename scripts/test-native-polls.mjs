import assert from "node:assert/strict";

Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
const { db } = await import("../dist/db.js");
const { settlementData, collectFinalVotes, applyFinalVotes } = await import("../dist/services/scoring.js");
const { storedQuizOptions } = await import("../dist/services/quiz-options.js");
const { pollControls } = await import("../dist/services/poll-controls.js");
const { dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { getHelpContent } = await import("../dist/commands/help.js");
const { messageLanguages } = await import("../dist/messages.js");
const expiresAt = new Date(Date.now() - 1000);
const metadata = settlementData({ id: "quiz", channelId: "channel", poll: { allowMultiselect: false, expiresAt,
  answers: new Map([[93, { id: 93, text: "Miedź" }], [17, { id: 17, text: "Żelazo" }]]) } },
  "guild", "medium", ["Żelazo", "Miedź"], 0);
let selected = 93, finalized = false, voterReads = 0;
const claimed = new Set(), answers = [], scores = new Map();
db.$transaction = async work => work({
  quizSettlement: { updateMany: async ({ where }) => {
    if (claimed.has(where.messageId)) return { count: 0 };
    claimed.add(where.messageId); return { count: 1 };
  } },
  quizAnswer: { create: async ({ data }) => { answers.push(data); return data; },
    findMany: async ({ where }) => answers.filter(answer => answer.guildId === where.guildId && answer.userId === where.userId) },
  userScore: { upsert: async ({ create, update }) => { scores.set(create.userId, update); return update; } }
});
const client = { user: { id: "bot" }, rest: { get: async route => {
  if (!route.includes("/answers/")) return { id: "quiz", channel_id: "channel", author: { id: "bot" }, poll: {
    allow_multiselect: false, expiry: expiresAt.toISOString(), answers: [{ answer_id: 17 }, { answer_id: 93 }],
    results: { is_finalized: finalized, answer_counts: [{ id: 17, count: Number(selected === 17) }, { id: 93, count: Number(selected === 93) }] }
  } };
  voterReads++;
  const answerId = Number(route.match(/\/answers\/(\d+)/)?.[1]);
  return { users: answerId === selected ? [{ id: "101", bot: false }] : [] };
} } };
try {
  assert.equal(metadata.correctAnswerId, 17);
  assert.equal(metadata.answerIds, "17,93");
  assert.equal(await collectFinalVotes(client, metadata), null);
  selected = 17;
  assert.equal(await collectFinalVotes(client, metadata), null);
  assert.equal(voterReads, 0, "Changing an open poll does not score or fetch voters");
  finalized = true;
  const correct = await collectFinalVotes(client, metadata);
  assert.deepEqual(correct.votes, [{ userId: "101", answerId: 17 }]);
  assert.equal(await applyFinalVotes(metadata, correct.votes, correct.finishedAt), true);
  assert.equal(await applyFinalVotes(metadata, correct.votes, correct.finishedAt), false);
  assert.equal(scores.get("101").points, 2);
  assert.equal(answers.length, 1);
  selected = 93;
  const wrong = await collectFinalVotes(client, metadata);
  assert.deepEqual(wrong.votes, [{ userId: "101", answerId: 93 }]);
  assert.equal(await applyFinalVotes({ ...metadata, messageId: "second-quiz" }, wrong.votes, wrong.finishedAt), true);
  assert.equal(answers.at(-1).points, 0);
  selected = null;
  const withdrawn = await collectFinalVotes(client, metadata);
  assert.deepEqual(withdrawn.votes, []);
  assert.equal(await applyFinalVotes({ ...metadata, messageId: "withdrawn-quiz" }, [], withdrawn.finishedAt), true);
  assert.equal(answers.length, 2, "A withdrawn vote adds no answer or streak reset");
  assert.deepEqual(storedQuizOptions('["A||B","C"]'), ["A||B", "C"]);
  assert.deepEqual(storedQuizOptions("A||B"), ["A", "B"]);
  assert.throws(() => settlementData({ poll: { allowMultiselect: true } }, "guild", "medium", ["A", "B"], 0));
  const commands = dilemmaCommand.toJSON().options.map(option => option.name);
  for (const name of ["block", "unblock", "blocks"]) assert.equal(commands.includes(name), false);
  for (const language of messageLanguages) {
    const buttons = pollControls(language).flatMap(row => row.toJSON().components);
    assert.deepEqual(buttons.map(button => button.custom_id), ["quiz:end"]);
    assert.equal(buttons[0].disabled, false);
    assert.equal(pollControls(language, true)[0].toJSON().components[0].disabled, true);
    assert.doesNotMatch(getHelpContent(language), /\/dilemma (?:block|unblock|blocks)\b/);
  }
  console.log(JSON.stringify({ check: "native-polls", passed: true, finalizedChoiceOnly: true,
    revoting: true, withdrawal: true, scoringIdempotent: true, actualAnswerIds: true, noVotingBlocks: true, closeButton: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "native-polls", passed: false,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-native-polls\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { globalThis.fetch = realFetch; await db.$disconnect(); }
