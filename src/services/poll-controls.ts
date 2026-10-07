import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes, type Client } from "discord.js";
import { message } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";

export const END_QUIZ_BUTTON_ID = "quiz:end";

export function pollControls(language: string, disabled = false) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(END_QUIZ_BUTTON_ID)
      .setLabel(message(language, "endQuizButton"))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  )];
}

export async function disablePollControls(client: Client, channelId: string, messageId: string, language: string) {
  try {
    await client.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: { components: pollControls(language, true).map(row => row.toJSON()), allowed_mentions: { parse: [] } }
    });
  } catch (error) {
    // A failed UI update must not prevent result publication or finalized-vote scoring.
    console.warn("Quiz button update failed:", privateErrorSummary(error));
  }
}
