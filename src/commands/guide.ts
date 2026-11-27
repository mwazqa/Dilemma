import { ComponentType, MessageFlags, SlashCommandSubcommandGroupBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { openFeedback } from "../feedback.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { getPlayerGuideContentHash, getPlayerGuidePayload, LEGACY_GUIDE_REFRESH_BUTTON_ID } from "../services/player-guide.js";
import { registerGuidePublication } from "../services/guide-publications.js";

export const guideCommand = new SlashCommandSubcommandGroupBuilder().setName("guide")
  .setDescription("Publish player guide and register this channel for major release updates.")
  .setDescriptionLocalizations({ pl: "Opublikuj poradnik i zarejestruj kanał dla ważnych aktualizacji wydań." })
  .addSubcommand(sub => sub.setName("publish")
    .setDescription("Publish player guide and major release updates here.")
    .setDescriptionLocalizations({ pl: "Opublikuj tu poradnik i ważne aktualizacje wydań." }));

export async function handleGuide(interaction: ChatInputCommandInteraction) {
  const { language, settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.isSendable()) { await reply(text("channel")); return; }
  let sent;
  try {
    sent = await channel.send({ ...getPlayerGuidePayload(language), nonce: interaction.id, enforceNonce: true });
  } catch {
    await reply(text("guidePublishFailed")); return;
  }
  try {
    await registerGuidePublication({ messageId: sent.id, guildId: interaction.guildId, channelId: channel.id },
      false, true, getPlayerGuideContentHash(language));
  } catch {
    await sent.delete().catch(() => {});
    await reply(text("guideSubscribeFailed")); return;
  }
  await interaction.deleteReply().catch(() => reply(text("guidePublished")));
}

export async function handleLegacyGuide(interaction: ButtonInteraction) {
  const { language, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  const source = interaction.message;
  const hasRefreshButton = source.components.some(row => row.type === ComponentType.ActionRow
    && row.components.some(component => component.type === ComponentType.Button && component.customId === LEGACY_GUIDE_REFRESH_BUTTON_ID));
  if (interaction.customId !== LEGACY_GUIDE_REFRESH_BUTTON_ID || source.author.id !== interaction.client.user.id
      || source.guildId !== interaction.guildId || source.channelId !== interaction.channelId
      || source.flags.has(MessageFlags.Ephemeral) || !hasRefreshButton) {
    await reply(text("guideUnavailable")); return;
  }
  try {
    await registerGuidePublication({ messageId: source.id, guildId: interaction.guildId, channelId: interaction.channelId }, true, false);
    await source.edit(getPlayerGuidePayload(language));
    await registerGuidePublication({ messageId: source.id, guildId: interaction.guildId, channelId: interaction.channelId },
      true, true, getPlayerGuideContentHash(language));
  } catch {
    await reply(text("guideRefreshFailed")); return;
  }
  await interaction.deleteReply().catch(() => reply(text("guidePublished")));
}
