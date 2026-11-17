import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { interactionLanguage, rememberLanguage } from "../feedback.js";
import { message, normalizeLanguage } from "../messages.js";
import { getGuildSettings } from "../services/guild-settings.js";
import { recordQuizReport, reportableQuiz, REPORT_MODAL_PREFIX, REPORT_REASON_MAX, REPORT_REASON_MIN } from "../services/quiz-reports.js";

async function reportLanguage(interaction: ButtonInteraction | ModalSubmitInteraction) {
  const language = normalizeLanguage((interaction.guildId ? (await getGuildSettings(interaction.guildId))?.language : interactionLanguage(interaction)) ?? "en");
  rememberLanguage(interaction, language);
  return language;
}

export async function handleQuizReportButton(interaction: ButtonInteraction) {
  const language = await reportLanguage(interaction);
  if (!interaction.guildId || interaction.user.bot || interaction.message.author.id !== interaction.client.user.id ||
    interaction.message.flags.has(MessageFlags.Ephemeral) || !await reportableQuiz({
      messageId: interaction.message.id, guildId: interaction.guildId, channelId: interaction.channelId
    })) {
    await interaction.reply({ content: message(language, "notPoll"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const reason = new TextInputBuilder().setCustomId("reason").setLabel(message(language, "quizReportReason"))
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(REPORT_REASON_MIN).setMaxLength(REPORT_REASON_MAX)
    .setPlaceholder(message(language, "quizReportPlaceholder"));
  await interaction.showModal(new ModalBuilder().setCustomId(`${REPORT_MODAL_PREFIX}${interaction.message.id}`)
    .setTitle(message(language, "quizReportTitle")).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason)));
}

export async function handleQuizReportModal(interaction: ModalSubmitInteraction) {
  const language = await reportLanguage(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let key: "notPoll" | "quizReportInvalid" | "quizReportSaved" | "quizReportExisting" = "notPoll";
  const messageId = interaction.customId.slice(REPORT_MODAL_PREFIX.length);
  if (interaction.customId.startsWith(REPORT_MODAL_PREFIX) && interaction.guildId && !interaction.user.bot && interaction.isFromMessage() &&
    interaction.message.author.id === interaction.client.user.id && interaction.message.id === messageId &&
    !interaction.message.flags.has(MessageFlags.Ephemeral)) {
    const result = await recordQuizReport({ messageId, guildId: interaction.guildId, channelId: interaction.channelId },
      interaction.user.id, interaction.fields.getTextInputValue("reason"));
    key = result === "saved" ? "quizReportSaved" : result === "existing" ? "quizReportExisting" : result === "invalid" ? "quizReportInvalid" : "notPoll";
  }
  await interaction.editReply({ content: message(language, key), allowedMentions: { parse: [] } });
}
