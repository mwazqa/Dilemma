import { ComponentType, MessageFlags, SlashCommandSubcommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { openFeedback } from "../feedback.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { getPlayerGuidePayload, GUIDE_REFRESH_BUTTON_ID } from "../services/player-guide.js";

export const guideCommand = new SlashCommandSubcommandBuilder().setName("guide")
  .setDescription("Publish the player guide here. Requires server management or the Dilemma manager role.");

export async function handleGuide(interaction: ChatInputCommandInteraction) {
  const { language, settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.isSendable()) { await reply(text("channel")); return; }
  try {
    await channel.send({ ...getPlayerGuidePayload(language), nonce: interaction.id, enforceNonce: true });
  } catch {
    await reply(text("guidePublishFailed")); return;
  }
  await interaction.deleteReply().catch(() => reply(text("guidePublished")));
}

export async function handleGuideRefresh(interaction: ButtonInteraction) {
  const { language, settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
  const source = interaction.message;
  const hasRefreshButton = source.components.some(row => row.type === ComponentType.ActionRow
    && row.components.some(component => component.type === ComponentType.Button && component.customId === GUIDE_REFRESH_BUTTON_ID));
  if (interaction.customId !== GUIDE_REFRESH_BUTTON_ID || source.author.id !== interaction.client.user.id
      || source.guildId !== interaction.guildId || source.channelId !== interaction.channelId
      || source.flags.has(MessageFlags.Ephemeral) || !hasRefreshButton) {
    await reply(text("guideUnavailable")); return;
  }
  try {
    await source.edit(getPlayerGuidePayload(language));
  } catch {
    await reply(text("guideRefreshFailed")); return;
  }
  await interaction.deleteReply().catch(() => reply(text("guidePublished")));
}
