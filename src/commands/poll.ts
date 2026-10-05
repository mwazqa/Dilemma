import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { getResultMessage } from "../brand.js";

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
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command works only inside a server.", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "Manage Server permission required.", ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
    await interaction.reply({ content: "This channel cannot contain polls.", ephemeral: true });
    return;
  }

  const messageId = interaction.options.getString("message_id", true).trim();
  try {
    const message = await channel.messages.fetch(messageId);
    if (!message.poll) {
      await interaction.reply({ content: "That message is not a poll.", ephemeral: true });
      return;
    }
    const generatedPoll = await db.generatedPoll.findUnique({ where: { messageId } });
    const randomPoll = generatedPoll ? null : await db.randomPoll.findUnique({ where: { messageId } });
    await message.poll.end();
    if (!generatedPoll && !randomPoll) {
      await interaction.reply({ content: "Poll ended. Final results are now visible.", ephemeral: true });
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
    const language = generatedPoll
      ? (await db.topic.findUnique({ where: { id: generatedPoll.topicId } }))?.language ?? "en"
      : randomPoll!.language;
    await channel.send(getResultMessage(language, correctAnswer, poll.explanation, resultEmojis[poll.correctOption] ?? ""));
    await interaction.reply({ content: "Poll ended and results published.", ephemeral: true });
  } catch {
    await interaction.reply({ content: "Poll not found in this channel or it is already closed.", ephemeral: true });
  }
}
