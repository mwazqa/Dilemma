import { ChannelType, SlashCommandSubcommandGroupBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { bulletList } from "../formatting.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { assignQuizChannel, QuizChannelAccessError, resolveQuizChannel } from "../services/quiz-channels.js";

export const channelsCommand = new SlashCommandSubcommandGroupBuilder()
  .setName("random-channels")
  .setDescription("Restrict random quizzes to selected channels; an empty list allows all channels.")
  .addSubcommand(command => command.setName("add").setDescription("Add an allowed random-quiz channel; the first entry enables restrictions.")
    .addChannelOption(option => option.setName("channel").setDescription("Server channel for random quizzes.").setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand(command => command.setName("remove").setDescription("Remove an allowed channel; removing the last entry allows random quizzes everywhere.")
    .addChannelOption(option => option.setName("channel").setDescription("Random-quiz channel to remove; other allowed channels stay enabled.").setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand(command => command.setName("list").setDescription("Show this server's assigned random quiz channels."));

export async function handleChannels(interaction: ChatInputCommandInteraction) {
  const { settings, text, reply, replyBlocks } = await openFeedback(interaction);
  if (!interaction.guildId || !interaction.guild) { await reply(text("serverOnly")); return; }
  if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
  const action = interaction.options.getSubcommand();
  if (action === "list") {
    const rows = await db.quizChannel.findMany({ where: { guildId: interaction.guildId }, orderBy: { channelId: "asc" }, select: { channelId: true } });
    if (!rows.length) { await reply(text("quizChannelsEmpty")); return; }
    await replyBlocks([text("quizChannelsTitle"), ...rows.map(row => bulletList([`<#${row.channelId}>`]))]);
    return;
  }
  if (action !== "add" && action !== "remove") return;
  const selected = interaction.options.getChannel("channel", true);
  if ("guildId" in selected && selected.guildId !== interaction.guildId) { await reply(text("quizChannelInvalid")); return; }
  let channel;
  try { channel = await resolveQuizChannel(interaction.guild, selected.id, action === "add"); }
  catch (error) {
    if (!(error instanceof QuizChannelAccessError)) throw error;
    await reply(text(error.feedback)); return;
  }
  const key = { guildId: interaction.guildId, channelId: channel.id };
  if (action === "add") {
    await assignQuizChannel(key.guildId, key.channelId);
    await reply(text("quizChannelAdded", { channel: `<#${channel.id}>` }));
    return;
  }
  const removed = await db.quizChannel.deleteMany({ where: key });
  if (!removed.count) { await reply(text("quizChannelNotAssigned", { channel: `<#${channel.id}>` })); return; }
  const remaining = await db.quizChannel.findFirst({ where: { guildId: interaction.guildId }, select: { channelId: true } });
  await reply(text(remaining ? "quizChannelRemoved" : "randomChannelsUnrestricted", { channel: `<#${channel.id}>` }));
}
