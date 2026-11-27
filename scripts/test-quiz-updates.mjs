import assert from "node:assert/strict";
Object.assign(process.env, { DATABASE_URL: "postgresql://test:test@127.0.0.1:1/dilemma_test", DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { quizVotingPayload, wagerRanges, WITHDRAW_COST } = await import("../dist/services/quiz-voting.js");
const { quizWeekStart } = await import("../dist/services/quiz-limits.js");
const { recentRandomCategories, normalizeRandomCategory } = await import("../dist/services/random-categories.js");
const { levelUpSparks } = await import("../dist/services/sparks.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const { handleWagerButton } = await import("../dist/commands/quiz-vote.js");
const { dilemmaCommand } = await import("../dist/commands/dilemma.js");
const { db } = await import("../dist/db.js");
try {
  const history = [null, "", ...Array.from({ length: 65 }, (_, i) => `Topic ${i + 1}`)];
  assert.deepEqual(recentRandomCategories(history), history.slice(2, 66));
  assert.equal(normalizeRandomCategory(" City-Planning! "), normalizeRandomCategory("city planning"));
  assert.equal(levelUpSparks(0, 30), 0);
  assert.equal(levelUpSparks(90, 100), 5);
  assert.equal(levelUpSparks(100, 100), 0);
  assert.equal(dilemmaCommand.toJSON().options.find(option => option.name === "random").options.find(option => option.name === "duration_hours").max_value, 6);
  assert.deepEqual(wagerRanges, { easy: { min: 1, max: 10 }, medium: { min: 10, max: 25 }, hard: { min: 25, max: 50 } });
  assert.equal(WITHDRAW_COST, 1);
  assert.equal(quizWeekStart(new Date("2026-11-22T22:59:59Z"), "Europe/Warsaw"), "2026-11-16");
  assert.equal(quizWeekStart(new Date("2026-11-22T23:00:00Z"), "Europe/Warsaw"), "2026-11-23");
  assert.equal(quizWeekStart(new Date("2026-11-22T23:00:00Z"), "UTC"), "2026-11-16");
  const feedbackKeys=["wagerRefunded","wagerExisting","wagerPlaced","wagerVoteFirst","wagerInvalid","fiftyResult","fiftyUnavailable","revealUnlocked","quizWeeklyToolLimit","sparksCharged","sparksInsufficient","votingClosed","voteEliminated","voteMissing","voteWithdrawn","voteSaved","randomDurationInvalid"];
  for(const language of messageLanguages)for(const key of feedbackKeys){
    const reply=message(language,key,{amount:2,answer:2,payout:4,min:10,max:25,cost:5,tool:"50/50"});
    assert.ok(feedbackKaomoji[key]&&reply.includes(feedbackKaomoji[key]),`${language}: ${key} keeps Dilemma's kaomoji`);
    assert.ok(reply.includes("~"),`${language}: ${key} keeps Dilemma's warm voice`);
    assert.doesNotMatch(reply,/\{\w+\}/);assert.ok(reply.length<=2000);
  }
  for (const language of messageLanguages) for (const count of [2, 3, 4]) {
    const options = ["Alpha", "Beta", "Gamma", "Delta"].slice(0, count);
    const payload = await quizVotingPayload({ question: "Question?", options, optionEmojis: options.map(() => "") }, new Date(Date.now() + 3_600_000), language);
    assert.equal(payload.poll, undefined);
    const buttons = payload.components.flatMap(row => row.toJSON().components);
    assert.deepEqual(buttons.map(button => button.custom_id), [...options.map((_, i) => `quiz:vote:${i + 1}`), "quiz:me", "quiz:withdraw", "quiz:reveal", "quiz:fifty", "quiz:wager", "quiz:report", "quiz:end"]);
    assert.equal(buttons.find(button => button.custom_id === "quiz:fifty").disabled, count === 2);
    assert.equal(buttons.find(button => button.custom_id === "quiz:fifty").label, "50/50");
    assert.equal(buttons.find(button => button.custom_id === "quiz:reveal").label, message(language, "revealVotesButton"));
    assert.ok(buttons.every(button => button.label.length <= 80));
    assert.ok(payload.components.every(row => row.toJSON().components.length <= 5));
    assert.doesNotMatch(JSON.stringify(payload), /correctOption|correctAnswerId|answer_counts|finalCounts|\d%/);
  }
  await assert.rejects(quizVotingPayload({ question: "Question?", options: ["Only"], optionEmojis: [""] }, new Date(), "pl"));
  let modal;
  db.guildSettings.findUnique = async () => ({ language: "pl" });
  db.quizSettlement.findUnique = async ({ where }) => {
    assert.equal(where.channelId, "channel");
    assert.equal(where.messageId, "quiz");
    return { difficulty: "hard", expiresAt: new Date(Date.now() + 60_000), scoredAt: null, closedAt: null };
  };
  await handleWagerButton({ customId: "quiz:wager", guildId: "test-guild", channelId: "channel", locale: "pl", user: { id: "player", bot: false }, message: { id: "quiz", author: { id: "bot" } },
    client: { user: { id: "bot" } }, showModal: async value => modal = value.toJSON() });
  assert.equal(modal.custom_id, "quiz:wager:quiz");
  assert.ok(modal.title.length <= 45);
  assert.equal(modal.components[0].components[0].custom_id, "amount");
  assert.equal(modal.components[0].components[0].max_length, 2);
  assert.equal(modal.components[0].components[0].label, message("pl", "wagerAmount", { min: 25, max: 50 }));
  let privateModal;
  await handleWagerButton({ customId: "quiz:me:quiz:wager", guildId: "test-guild", channelId: "channel", locale: "en", user: { id: "player", bot: false },
    message: { id: "private-panel", author: { id: "bot" }, flags: { has: () => true } }, client: { user: { id: "bot" } },
    showModal: async value => privateModal = value.toJSON() });
  assert.equal(privateModal.custom_id, "quiz:wager:quiz:private-panel");
  assert.equal(privateModal.title, message("pl", "wagerTitle"), "The modal uses the server language even when the player's locale differs");
  assert.equal(message("pl", "sparksName"), "Iskry");
  console.log(JSON.stringify({check:"quiz-updates",passed:true,layouts234:true,noLiveCounters:true,minimumTwo:true,privateWagerModal:true,topics64:true,locales:messageLanguages.length}));
} catch (error) {
  console.error(JSON.stringify({check:"quiz-updates",passed:false,category:error instanceof assert.AssertionError?"assertion":"test-error",line:Number(error.stack?.match(/test-quiz-updates\.mjs:(\d+)/)?.[1]??0)}));
  process.exitCode=1;
} finally { await db.$disconnect(); }
