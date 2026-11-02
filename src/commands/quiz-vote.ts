import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { interactionLanguage, openFeedback } from "../feedback.js";
import { message } from "../messages.js";
import { db } from "../db.js";
import { castQuizVote, useQuizTool, VOTE_PREFIX, WITHDRAW_VOTE_ID, REVEAL_VOTES_ID, FIFTY_FIFTY_ID,
  WITHDRAW_COST, REVEAL_COST, FIFTY_FIFTY_COST, MAX_WAGER, WAGER_MODAL_PREFIX, placeQuizWager, voteBreakdown } from "../services/quiz-voting.js";
import { storedQuizOptions } from "../services/quiz-options.js";
import { MY_QUIZ_BUTTON_ID } from "../services/poll-controls.js";
import { personalQuizAction, quizPersonalPayload } from "../services/quiz-personal.js";

export async function handleQuizVote(interaction: ButtonInteraction) {
  const personal = personalQuizAction(interaction.customId, interaction.message.id);
  const { language, text, reply } = await openFeedback(interaction, interaction.customId.startsWith(`${MY_QUIZ_BUTTON_ID}:`));
  if (!interaction.guildId || interaction.user.bot || interaction.message.author.id !== interaction.client.user.id) { await reply(text("notPoll")); return; }
  if (interaction.customId.startsWith(MY_QUIZ_BUTTON_ID) && !personal) { await reply(text("notPoll")); return; }
  const identity = { messageId: personal?.messageId ?? interaction.message.id, guildId: interaction.guildId, channelId: interaction.channelId };
  const panel = async (notice?: string) => reply(await quizPersonalPayload(identity, interaction.user.id, language, notice) ?? text("notPoll"));
  if (personal?.action === "view") { await panel(); return; }
  if (interaction.customId === REVEAL_VOTES_ID || interaction.customId === FIFTY_FIFTY_ID) {
    const quiz = await db.generatedPoll.findUnique({ where: { messageId: identity.messageId } })
      ?? await db.randomPoll.findUnique({ where: { messageId: identity.messageId } });
    if (!quiz || quiz.guildId !== identity.guildId || quiz.channelId !== identity.channelId) { await reply(text("notPoll")); return; }
    const kind = interaction.customId === FIFTY_FIFTY_ID ? "fifty" : "reveal";
    const result = await useQuizTool(identity, interaction.user.id, kind);
    if (result.status === "closed") { await panel(); return; }
    if (result.status === "unavailable") { await reply(text("fiftyUnavailable")); return; }
    if (result.status === "insufficient") { await reply(text("sparksInsufficient", { cost: kind === "fifty" ? FIFTY_FIFTY_COST : REVEAL_COST })); return; }
    const options = storedQuizOptions(quiz.options);
    if (result.status === "hint") {
      await panel();
    } else await reply(voteBreakdown(language, options, result.counts) + `\n\n${text("revealUnlocked")}`);
    return;
  }
  const withdrawing = interaction.customId === WITHDRAW_VOTE_ID || personal?.action === "withdraw";
  if (!withdrawing && !personal?.answerId && !/^quiz:vote:[1-4]$/.test(interaction.customId)) { await reply(text("notPoll")); return; }
  const answerId = withdrawing ? null : personal?.answerId ?? Number(interaction.customId.slice(VOTE_PREFIX.length));
  const result = await castQuizVote(identity, interaction.user.id, answerId);
  if (result.status === "closed") { await panel(); return; }
  if (result.status === "invalid") { await reply(text("notPoll")); return; }
  if (result.status === "insufficient") { await panel(text("sparksInsufficient", { cost: WITHDRAW_COST })); return; }
  if (result.status === "missing") { await panel(text("voteMissing")); return; }
  if (result.status === "eliminated") { await panel(text("voteEliminated")); return; }
  const content = withdrawing ? text("voteWithdrawn") : text("voteSaved", { answer: answerId! });
  await panel(content + (result.charged ? `\n${text("sparksCharged", { cost: result.charged })}` : "")
    + ("refunded" in result && result.refunded ? `\n${text("wagerRefunded", { amount: result.refunded })}` : ""));
}

export async function handleWagerButton(interaction: ButtonInteraction) {
  const language = interactionLanguage(interaction);
  if (!interaction.guildId || interaction.user.bot || interaction.message.author.id !== interaction.client.user.id) {
    await interaction.reply({ content: message(language, "notPoll"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }); return;
  }
  const amount = new TextInputBuilder().setCustomId("amount").setLabel(message(language, "wagerAmount", { max: MAX_WAGER }))
    .setPlaceholder(message(language, "wagerPlaceholder")).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(String(MAX_WAGER).length).setRequired(true);
  await interaction.showModal(new ModalBuilder().setCustomId(`${WAGER_MODAL_PREFIX}${interaction.message.id}`)
    .setTitle(message(language, "wagerTitle")).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amount)));
}

export async function handleWagerModal(interaction: ModalSubmitInteraction) {
  const { text, reply } = await openFeedback(interaction);
  if (!interaction.guildId || !interaction.channelId || interaction.user.bot || !interaction.customId.startsWith(WAGER_MODAL_PREFIX)) { await reply(text("notPoll")); return; }
  const messageId = interaction.customId.slice(WAGER_MODAL_PREFIX.length);
  if (!messageId || (interaction.message && (interaction.message.id !== messageId || interaction.message.author.id !== interaction.client.user.id))) {
    await reply(text("notPoll")); return;
  }
  const input = interaction.fields.getTextInputValue("amount").trim();
  if (!/^\d{1,2}$/.test(input)) { await reply(text("wagerInvalid", { max: MAX_WAGER })); return; }
  const amount = Number(input);
  const result = await placeQuizWager({ messageId, guildId: interaction.guildId, channelId: interaction.channelId }, interaction.user.id, amount);
  if (result.status === "invalid") { await reply(text("wagerInvalid", { max: MAX_WAGER })); return; }
  if (result.status === "closed") { await reply(text("votingClosed")); return; }
  if (result.status === "missing") { await reply(text("wagerVoteFirst")); return; }
  if (result.status === "insufficient") { await reply(text("sparksInsufficient", { cost: amount })); return; }
  await reply(text(result.status === "existing" ? "wagerExisting" : "wagerPlaced", {
    amount: result.amount, answer: result.answerId, payout: result.amount * 2
  }));
}
