import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction } from "discord.js";
import { env } from "../config.js";
import { db } from "../db.js";
import { message, type MessageKey } from "../messages.js";
import { approveQuizCorrection, CORRECTION_ACCEPT_PREFIX, CORRECTION_BUTTON_PREFIX, CORRECTION_MODAL_PREFIX, CORRECTION_TEXT_MAX,
  correctionAnalysis, suggestedCorrection, suggestedGenerationRule } from "../services/quiz-corrections.js";
import { GENERATION_RULE_MAX_LENGTH } from "../services/quiz-generation-rules.js";

const GENERATION_RULE_FIELD = "generation-rule";

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
  const rule = new TextInputBuilder().setCustomId(GENERATION_RULE_FIELD).setStyle(TextInputStyle.Paragraph)
    .setLabel(message(language, "quizGenerationRuleLabel")).setPlaceholder(message(language, "quizGenerationRulePlaceholder"))
    .setRequired(false).setMaxLength(GENERATION_RULE_MAX_LENGTH);
  const suggestedRule = suggestedGenerationRule(analysis);
  if (suggestedRule) rule.setValue(suggestedRule);
  await interaction.showModal(new ModalBuilder().setCustomId(`${CORRECTION_MODAL_PREFIX}${reportId}`)
    .setTitle(message(language, "quizCorrectionDialog")).addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input), new ActionRowBuilder<TextInputBuilder>().addComponents(rule)));
}

export async function handleQuizCorrectionModal(interaction: ModalSubmitInteraction) {
  const reportId = interaction.customId.slice(CORRECTION_MODAL_PREFIX.length);
  if (!isOwnerDm(interaction) || !interaction.isFromMessage() || !/^[a-z0-9]{20,32}$/.test(reportId)) return unavailable(interaction);
  const rule = interaction.fields.fields?.has(GENERATION_RULE_FIELD) ? interaction.fields.getTextInputValue(GENERATION_RULE_FIELD) : "";
  return confirmCorrection(interaction, reportId, interaction.fields.getTextInputValue("correction"), rule);
}

async function confirmCorrection(interaction: ButtonInteraction | ModalSubmitInteraction, reportId: string, text?: string, rule?: string) {
  await interaction.deferReply();
  const result = await approveQuizCorrection(reportId, text, rule);
  const feedback = {
    approved: result.status === "approved" && result.generationRule ? "quizCorrectionApprovedWithRule" : "quizCorrectionApproved",
    already: "quizCorrectionAlready", unavailable: "quizCorrectionUnavailable", pending: "quizCorrectionPending",
    invalid: "quizCorrectionInvalid", "invalid-rule": "quizGenerationRuleInvalid", "balance-limit": "quizCorrectionBalanceLimit"
  } satisfies Record<typeof result.status, MessageKey>;
  const values = result.status === "approved" ? { sparks: result.correction.refundedSparks.toString() } : undefined;
  await interaction.editReply({ content: message(env.QUIZ_REPORT_REVIEW_LANGUAGE, feedback[result.status], values), allowedMentions: { parse: [] } });
}
