import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { getResultMessage } from "../brand.js";
import { openFeedback } from "../feedback.js";

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
    await message.poll.end();
    if (!generatedPoll && !randomPoll) {
      await reply(text("pollDone"));
      return;
    }

    const poll = generatedPoll ?? randomPoll!;
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
  } catch {
    await reply(text("pollFailed"));
  }
}
