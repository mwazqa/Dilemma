import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { getResultMessage } from "../brand.js";
import { openFeedback } from "../feedback.js";
import { runDueSettlements } from "../services/scoring.js";

export const pollCommand = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("Manage Dilemma polls.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand((subcommand) => subcommand
    .setName("end")
    .setDescription("End a poll immediately.")
    .addStringOption((option) => option
      .setName("message_id")
      .setDescription("ID of the poll message.")
      .setRequired(true)));

export async function handlePoll(interaction: ChatInputCommandInteraction) {
  const { language, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(text("permission"));
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
    await reply(text("channel"));
    return;
  }

  const messageId = interaction.options.getString("message_id", true).trim();
  try {
    const message = await channel.messages.fetch(messageId);
    if (!message.poll) {
      await reply(text("notPoll"));
      return;
    }
    const generatedPoll = await db.generatedPoll.findUnique({ where: { messageId } });
    const randomPoll = generatedPoll ? null : await db.randomPoll.findUnique({ where: { messageId } });
    if (!generatedPoll && !randomPoll) {
      await reply(text("notPoll"));
      return;
    }

    const poll = generatedPoll ?? randomPoll!;
    if (poll.guildId !== interaction.guildId || poll.channelId !== channel.id || message.author.id !== interaction.client.user.id) {
      await reply(text("notPoll"));
      return;
    }
    if (poll.endedAt) {
      await reply(text("pollDone"));
      return;
    }
    if (!message.poll.expiresTimestamp || message.poll.expiresTimestamp > Date.now()) await message.poll.end();
    await db.quizSettlement.updateMany({ where: { messageId, guildId: interaction.guildId, scoredAt: null }, data: { closedAt: new Date(), nextCheckAt: new Date() } });
    const options = poll.options.split("||");
    const correctAnswer = options[poll.correctOption] ?? "Unknown";
    const resultEmojis = poll.optionEmojis.split("||");
    if (generatedPoll) {
      await db.generatedPoll.update({ where: { messageId }, data: { endedAt: new Date() } });
    } else {
      await db.randomPoll.update({ where: { messageId }, data: { endedAt: new Date() } });
    }
    await channel.send({ content: getResultMessage(language, correctAnswer, poll.explanation, resultEmojis[poll.correctOption] ?? ""), allowedMentions: { parse: [] } });
    await reply(text("pollDone"));
    void runDueSettlements(interaction.client);
  } catch {
    await reply(text("pollFailed"));
  }
}
