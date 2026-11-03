import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";
requireTestDatabase(process.env);
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { ButtonStyle, MessageFlags } = await import("discord.js");
const { buttonSettlementData, placeQuizWager, quizVotingPayload } = await import("../dist/services/quiz-voting.js");
const { quizPersonalPayload } = await import("../dist/services/quiz-personal.js");
const { handleQuizVote, handleWagerButton, handleWagerModal } = await import("../dist/commands/quiz-vote.js");
const { closeQuiz } = await import("../dist/services/quiz-closure.js");
const { applyFinalVotes } = await import("../dist/services/scoring.js");
const { message, messageLanguages, feedbackKaomoji } = await import("../dist/messages.js");
const identity = { guildId: `personal-${randomUUID()}`, channelId: "test-channel", messageId: `quiz-${randomUUID()}` };
const options = ["Alpha", "Beta", "Gamma", "Delta"];
const client = { user: { id: "bot" } };
const replies = [];
let deferred, updated, stage = "setup";
const request = (customId, userId = "alice", privateMessage = false, overrides = {}) => ({
  ...identity, customId, client, locale: "en", user: { id: userId, bot: false },
  message: { id: privateMessage ? "private-response" : identity.messageId, author: { id: "bot" }, flags: { has: () => privateMessage } },
  deferReply: async payload => { assert.equal(payload.flags, MessageFlags.Ephemeral); deferred++; },
  deferUpdate: async () => { updated++; },
  editReply: async payload => { assert.deepEqual(payload.allowedMentions.parse, []); replies.push(payload); }, ...overrides
});
const press = async (...args) => { deferred = updated = 0; await handleQuizVote(request(...args)); return replies.at(-1); };
const buttons = payload => payload.components.flatMap(row => row.toJSON().components);
const choices = payload => buttons(payload).filter(button => button.custom_id?.includes(":vote:"));
const checkQuizLink = (payload, language) => {
  const links = buttons(payload).filter(button => button.style === ButtonStyle.Link);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, `https://discord.com/channels/${identity.guildId}/${identity.channelId}/${identity.messageId}`);
  assert.equal(links[0].label, message(language, "quizJumpButton"));
  assert.equal(links[0].custom_id, undefined, "Navigation does not submit a quiz action");
  assert.ok(payload.components.every(row => row.toJSON().components.length <= 5));
};
const wallet = async userId => (await db.userScore.findUnique({ where: { guildId_userId: { guildId: identity.guildId, userId } } })).sparks;
try {
  const quiz = await db.quizSettlement.create({ data: buttonSettlementData(identity, "medium", 4, 0, new Date(Date.now() + 3_600_000)) });
  await db.randomPoll.create({ data: { ...identity, language: "en", question: "Test question?", options: JSON.stringify(options), correctOption: 0, explanation: "Test fact." } });
  for (const userId of ["alice", "bob"]) await db.userScore.create({ data: { guildId: identity.guildId, userId, sparks: 20 } });
  stage = "saved-choice";
  let panel = await press("quiz:vote:2");
  assert.equal(deferred, 1); assert.equal(updated, 0);
  assert.ok(panel.content.includes(message("en", "quizChosenAnswer", { answer: "2. Beta" })));
  assert.equal(choices(panel).filter(button => button.style === ButtonStyle.Success)[0].custom_id, `quiz:me:${quiz.messageId}:vote:2`);
  assert.equal(await wallet("alice"), 20);
  assert.ok(!buttons(panel).find(button => button.custom_id === `quiz:me:${quiz.messageId}:wager`).disabled);
  for (const language of messageLanguages) {
    const localized = await quizPersonalPayload(identity, "alice", language);
    assert.equal(buttons(localized).find(button => button.custom_id?.endsWith(":wager")).label, message(language, "wagerButton"));
    checkQuizLink(localized, language);
  }
  const publicQuiz = await quizVotingPayload({ question: "Test question?", options, optionEmojis: [] }, quiz.expiresAt, "en", false);
  assert.ok(publicQuiz.components[0].toJSON().components.every(button => button.style === ButtonStyle.Primary));
  assert.ok(buttons(publicQuiz).some(button => button.custom_id === "quiz:me"));
  stage = "private-change";
  panel = await press(`quiz:me:${quiz.messageId}:vote:1`, "alice", true);
  assert.equal(deferred, 0); assert.equal(updated, 1); assert.equal(await wallet("alice"), 19);
  assert.equal(choices(panel).find(button => button.style === ButtonStyle.Success).label, "1. Alpha");
  await press(`quiz:me:${quiz.messageId}:vote:1`, "alice", true);
  assert.equal(await wallet("alice"), 19, "Repeating a saved choice does not charge again");
  panel = await press("quiz:me", "bob");
  assert.ok(panel.content.includes(message("en", "quizNoChoice")));
  assert.ok(choices(panel).every(button => button.style !== ButtonStyle.Success), "Another player never sees Alice's choice");
  assert.ok(buttons(panel).find(button => button.custom_id?.endsWith(":wager")).disabled, "Betting needs a saved answer");
  await press(`quiz:me:${quiz.messageId}:view`, "bob", false);
  assert.equal(deferred, 1); assert.equal(updated, 0, "Public messages are never edited with personal data");
  stage = "fifty-buttons";
  panel = await press("quiz:fifty");
  checkQuizLink(panel, "en");
  assert.equal(choices(panel).length, 2); assert.equal(await wallet("alice"), 14);
  const remaining = choices(panel).map(button => Number(button.custom_id.at(-1)));
  assert.ok(remaining.includes(1));
  await press("quiz:fifty"); assert.equal(await wallet("alice"), 14, "Reopening 50/50 is free");
  const eliminated = [1, 2, 3, 4].find(id => !remaining.includes(id));
  panel = await press(`quiz:vote:${eliminated}`);
  assert.equal(choices(panel).length, 2); assert.equal(await wallet("alice"), 14);
  assert.ok(panel.content.includes(message("en", "voteEliminated")));
  await db.quizVote.update({ where: { messageId_userId: { messageId: quiz.messageId, userId: "alice" } }, data: { answerId: eliminated } });
  panel = await press("quiz:me");
  assert.ok(panel.content.includes(message("en", "quizHintChoiceEliminated")));
  assert.ok(choices(panel).every(button => button.style !== ButtonStyle.Success), "50/50 never silently changes the saved vote");
  await press(`quiz:me:${quiz.messageId}:vote:1`, "alice", true);
  assert.equal(await wallet("alice"), 13);
  stage = "withdraw";
  panel = await press(`quiz:me:${quiz.messageId}:withdraw`, "alice", true);
  assert.equal(await wallet("alice"), 12);
  assert.ok(panel.content.includes(message("en", "quizNoChoice")));
  assert.ok(buttons(panel).find(button => button.custom_id?.endsWith(":withdraw")).disabled);
  await press(`quiz:me:${quiz.messageId}:vote:1`, "alice", true);
  assert.equal(await wallet("alice"), 12, "Voting after withdrawal remains free");
  await press("quiz:vote:2", "bob");
  stage = "private-wager-modal";
  let modal;
  await handleWagerButton({ ...request(`quiz:me:${quiz.messageId}:wager`, "alice", true), showModal: async value => modal = value.toJSON() });
  assert.equal(modal.custom_id, `quiz:wager:${quiz.messageId}:private-response`);
  assert.equal(await wallet("alice"), 12, "Opening a wager form never spends Sparks");
  const submit = async (amount, overrides = {}) => {
    deferred = updated = 0;
    await handleWagerModal({ ...request(modal.custom_id, "alice", true), fields: { getTextInputValue: () => String(amount) }, ...overrides });
    return replies.at(-1);
  };
  panel = await submit(10, { message: { id: "different-private-response", author: { id: "bot" }, flags: { has: () => true } } });
  assert.equal(panel.content, message("en", "notPoll")); assert.equal(await wallet("alice"), 12);
  panel = await submit(10, { message: { id: "private-response", author: { id: "bot" }, flags: { has: () => false } } });
  assert.equal(panel.content, message("en", "notPoll")); assert.equal(await wallet("alice"), 12);
  panel = await submit(10, { message: { id: "private-response", author: { id: "stranger" }, flags: { has: () => true } } });
  assert.equal(panel.content, message("en", "notPoll")); assert.equal(await wallet("alice"), 12);
  panel = await submit(10, { channelId: "another-channel" });
  assert.equal(panel.content, message("en", "notPoll")); assert.equal(await wallet("alice"), 12);
  assert.equal(modal.components[0].components[0].label, message("en", "wagerAmount", { max: 10 }));
  for (const amount of [11, 20, 21]) {
    panel = await submit(amount);
    assert.ok(panel.content.includes(message("en", "wagerInvalid", { max: 10 }))); assert.equal(await wallet("alice"), 12);
  }
  await db.userScore.update({ where: { guildId_userId: { guildId: identity.guildId, userId: "alice" } }, data: { sparks: 9 } });
  panel = await submit(10);
  assert.ok(panel.content.includes(message("en", "sparksInsufficient", { cost: 10 }))); assert.equal(await wallet("alice"), 9);
  await db.userScore.update({ where: { guildId_userId: { guildId: identity.guildId, userId: "alice" } }, data: { sparks: 12 } });
  panel = await submit(10);
  assert.equal(updated, 1); assert.equal(deferred, 0, "Wager submission updates the existing private panel");
  assert.equal(await wallet("alice"), 2);
  assert.ok(panel.content.includes(message("en", "quizActiveWager", { stake: 10, payout: 20 })));
  assert.ok(buttons(panel).find(button => button.custom_id?.endsWith(":wager")).disabled);
  const savedWager = await db.quizWager.findUnique({ where: { messageId_userId: { messageId: quiz.messageId, userId: "alice" } } });
  assert.equal(savedWager.answerId, 1); assert.equal(savedWager.messageId, quiz.messageId);
  await submit(10);
  assert.equal(await wallet("alice"), 2, "Repeating a stale wager form never charges twice");
  await placeQuizWager(identity, "bob", 5);
  stage = "pending-result";
  await closeQuiz(quiz, false, "manager", "button", null);
  panel = await press("quiz:me");
  assert.ok(panel.content.includes(message("en", "quizResultPending")));
  assert.equal(choices(panel).length, 0);
  assert.ok(!buttons(panel).some(button => button.custom_id?.endsWith(":wager")), "Closed panels do not offer betting");
  checkQuizLink(panel, "en");
  assert.ok(!panel.content.includes(message("en", "quizCorrectAnswer", { answer: "1. Alpha" })));
  await applyFinalVotes(quiz, [], new Date());
  stage = "settled-result";
  panel = await press("quiz:me");
  assert.ok(panel.content.includes(message("en", "quizChosenAnswer", { answer: "1. Alpha" })));
  assert.ok(panel.content.includes(message("en", "quizAnswerWon", { points: 2 })));
  assert.ok(panel.content.includes(message("en", "quizWagerResult", { stake: 10, payout: 20, net: "+10" })));
  assert.equal(await wallet("alice"), 24);
  const before = await wallet("alice");
  await press(`quiz:me:${quiz.messageId}:vote:2`, "alice", true);
  assert.equal(await wallet("alice"), before, "A stale private panel cannot change settled answers or rewards");
  await submit(10);
  assert.equal(await wallet("alice"), before, "A stale wager form cannot charge after settlement");
  panel = await press("quiz:me", "bob");
  assert.ok(panel.content.includes(message("en", "quizAnswerLost", { points: 0, penalty: 3 })));
  assert.equal(await wallet("bob"), 12, "Wrong medium answer costs 3 Sparks in addition to the lost 5-Spark stake");
  assert.ok(panel.content.includes(message("en", "quizWagerResult", { stake: 5, payout: 0, net: -5 })));
  for (const language of messageLanguages) {
    const localized = await quizPersonalPayload(identity, "alice", language);
    assert.ok(localized.content.includes(message(language, "quizWagerResult", { stake: 10, payout: 20, net: "+10" })));
    checkQuizLink(localized, language);
    assert.ok(localized.content.length <= 2000 && !/\{\w+\}/.test(localized.content));
    for (const key of ["quizPersonalHeading", "quizResultHeading", "quizResultPending", "quizHintActive", "quizHintChoiceEliminated", "quizAnswerWon", "quizAnswerLost"]) {
      assert.ok(message(language, key).includes(feedbackKaomoji[key]));
    }
  }
  stage = "isolation";
  assert.equal(await quizPersonalPayload({ ...identity, guildId: "other" }, "alice", "en"), null);
  assert.equal(await quizPersonalPayload({ ...identity, channelId: "other" }, "alice", "en"), null);
  panel = await press("quiz:me", "alice", false, { message: { id: quiz.messageId, author: { id: "stranger" } } });
  assert.equal(panel.content, message("en", "notPoll"));
  await db.quizAnswer.deleteMany({ where: { guildId: identity.guildId, userId: "alice" } });
  await db.quizVote.deleteMany({ where: { guildId: identity.guildId, userId: "alice" } });
  await db.quizWager.deleteMany({ where: { guildId: identity.guildId, userId: "alice" } });
  panel = await press("quiz:me");
  assert.ok(panel.content.includes(message("en", "quizNoChoice")) && panel.content.includes(message("en", "quizNoWager")));
  console.log(JSON.stringify({ check: "quiz-personal-postgres", passed: true, privateSelection: true, privateWager: true, quizNavigation: true, paidChanges: true, fiftyButtons: true, payoutVsProfit: true, settledReadOnly: true, isolation: true, locales: messageLanguages.length }));
} catch (error) {
  console.error(JSON.stringify({ check: "quiz-personal-postgres", passed: false, stage, category: error instanceof assert.AssertionError ? "assertion" : "test-error", line: Number(error.stack?.match(/test-quiz-personal-postgres\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally {
  await db.quizSettlement.deleteMany({ where: { guildId: identity.guildId } });
  await db.randomPoll.deleteMany({ where: { guildId: identity.guildId } });
  await db.userScore.deleteMany({ where: { guildId: identity.guildId } });
  await db.$disconnect();
}
