import { SlashCommandSubcommandGroupBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { scheduleEvents } from "../services/schedule-events.js";
import { disablePollControls, END_QUIZ_BUTTON_ID } from "../services/poll-controls.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { publishQuizResults } from "../services/quiz-results.js";
import { closeQuiz } from "../services/quiz-closure.js";

const closingPolls = new Set<string>();

export const pollCommand = new SlashCommandSubcommandGroupBuilder()
  .setName("poll")
  .setDescription("Manage Dilemma polls.")
  .addSubcommand((subcommand) => subcommand
    .setName("end")
    .setDescription("End a managed poll or your own random quiz immediately.")
    .addStringOption((option) => option
      .setName("message_id")
      .setDescription("ID of the poll message.")
      .setRequired(true)));

export async function handlePoll(interaction: ChatInputCommandInteraction) {
  await endQuiz(interaction, interaction.options.getString("message_id", true).trim(), "command");
}

export async function handleEndPollButton(interaction: ButtonInteraction) {
  if (interaction.customId !== END_QUIZ_BUTTON_ID) return;
  await endQuiz(interaction, interaction.message.id, "button");
}

async function endQuiz(interaction: ChatInputCommandInteraction | ButtonInteraction, messageId: string, source: "button" | "command") {
  const { language, settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  const canManage = canManageDilemma(interaction, settings);

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
    await reply(text("channel"));
    return;
  }

  try {
    const generatedPoll = await db.generatedPoll.findUnique({ where: { messageId } });
    const randomPoll = generatedPoll ? null : await db.randomPoll.findUnique({ where: { messageId } });
    const isRandomCreator = randomPoll?.guildId === interaction.guildId && randomPoll.channelId === channel.id &&
      Boolean(randomPoll.creatorUserId && randomPoll.creatorUserId === interaction.user.id);
    if (!canManage && !isRandomCreator) {
      await reply(text("permission"));
      return;
    }
    if (!generatedPoll && !randomPoll) {
      await reply(text("notPoll"));
      return;
    }

    const poll = generatedPoll ?? randomPoll!;
    const message = await channel.messages.fetch(messageId);
    if (!message.poll || poll.guildId !== interaction.guildId || poll.channelId !== channel.id || message.author.id !== interaction.client.user.id) {
      await reply(text("notPoll"));
      return;
    }
    if (poll.endedAt) {
      await disablePollControls(interaction.client, channel.id, messageId, language);
      await reply(text("pollDone"));
      return;
    }
    if (closingPolls.has(messageId)) {
      await reply(text("pollClosing"));
      return;
    }
    closingPolls.add(messageId);
    try {
      const closedAt = await closeQuiz({ messageId, guildId: interaction.guildId, channelId: channel.id }, Boolean(generatedPoll), interaction.user.id, source, message.poll);
      if (closedAt) scheduleEvents.emit("settlementClosed", messageId, closedAt);
      await disablePollControls(interaction.client, channel.id, messageId, language);
      await publishQuizResults(interaction.client, poll, language, payload => channel.send(payload));
      await reply(text("pollDone"));
    } finally { closingPolls.delete(messageId); }
  } catch {
    await reply(text("pollFailed"));
  }
}
