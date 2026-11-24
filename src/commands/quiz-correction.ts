import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { env } from "../config.js";
import { db } from "../db.js";
import { message, type MessageKey } from "../messages.js";
import { approveQuizCorrection, CORRECTION_ACCEPT_PREFIX, CORRECTION_BUTTON_PREFIX, CORRECTION_MODAL_PREFIX, CORRECTION_TEXT_MAX,
  correctionAnalysis, suggestedCorrection } from "../services/quiz-corrections.js";

function isOwnerDm(interaction: ButtonInteraction | ModalSubmitInteraction) {
  return !interaction.guildId && !interaction.user.bot && interaction.user.id === env.QUIZ_REPORT_RECIPIENT_ID &&
    interaction.message?.author.id === interaction.client.user.id;
}

async function unavailable(interaction: ButtonInteraction | ModalSubmitInteraction) {
  await interaction.reply({ content: message(env.QUIZ_REPORT_REVIEW_LANGUAGE, "quizCorrectionUnavailable"),
    ...(interaction.guildId ? { flags: MessageFlags.Ephemeral } : {}), allowedMentions: { parse: [] } });
}

export async function handleQuizCorrectionButton(interaction: ButtonInteraction) {
  const accept = interaction.customId.startsWith(CORRECTION_ACCEPT_PREFIX);
  const reportId = interaction.customId.slice((accept ? CORRECTION_ACCEPT_PREFIX : CORRECTION_BUTTON_PREFIX).length);
  if (!isOwnerDm(interaction) || !/^[a-z0-9]{20,32}$/.test(reportId)) return unavailable(interaction);
  if (accept) return confirmCorrection(interaction, reportId);
  const report = await db.quizReport.findUnique({ where: { id: reportId } });
  const analysis = report && correctionAnalysis(report);
  if (!analysis) return unavailable(interaction);
  const language = env.QUIZ_REPORT_REVIEW_LANGUAGE;
  const input = new TextInputBuilder().setCustomId("correction").setStyle(TextInputStyle.Paragraph)
    .setLabel(message(language, "quizCorrectionText")).setPlaceholder(message(language, "quizCorrectionPlaceholder"))
    .setRequired(true).setMaxLength(CORRECTION_TEXT_MAX);
  const proposal = suggestedCorrection(analysis);
  if (proposal) input.setValue(proposal);
  await interaction.showModal(new ModalBuilder().setCustomId(`${CORRECTION_MODAL_PREFIX}${reportId}`)
    .setTitle(message(language, "quizCorrectionDialog")).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
}

export async function handleQuizCorrectionModal(interaction: ModalSubmitInteraction) {
  const reportId = interaction.customId.slice(CORRECTION_MODAL_PREFIX.length);
  if (!isOwnerDm(interaction) || !interaction.isFromMessage() || !/^[a-z0-9]{20,32}$/.test(reportId)) return unavailable(interaction);
  return confirmCorrection(interaction, reportId, interaction.fields.getTextInputValue("correction"));
}

async function confirmCorrection(interaction: ButtonInteraction | ModalSubmitInteraction, reportId: string, text?: string) {
  await interaction.deferReply();
  const result = await approveQuizCorrection(reportId, text);
  const feedback = {
    approved: "quizCorrectionApproved", already: "quizCorrectionAlready", unavailable: "quizCorrectionUnavailable",
    pending: "quizCorrectionPending", invalid: "quizCorrectionInvalid", "balance-limit": "quizCorrectionBalanceLimit"
  } satisfies Record<typeof result.status, MessageKey>;
  const values = result.status === "approved" ? { sparks: result.correction.refundedSparks.toString() } : undefined;
  await interaction.editReply({ content: message(env.QUIZ_REPORT_REVIEW_LANGUAGE, feedback[result.status], values), allowedMentions: { parse: [] } });
}
