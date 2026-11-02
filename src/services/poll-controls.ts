import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes, type Client } from "discord.js";
import { message } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";

export const END_QUIZ_BUTTON_ID = "quiz:end";
export const MY_QUIZ_BUTTON_ID = "quiz:me";
export function myQuizButton(language: string, messageId?: string, finished = false) {
  return new ButtonBuilder().setCustomId(messageId ? `${MY_QUIZ_BUTTON_ID}:${messageId}:view` : MY_QUIZ_BUTTON_ID)
    .setLabel(message(language, finished ? "myQuizResultButton" : "myQuizVoteButton")).setStyle(ButtonStyle.Secondary);
}
export function pollControls(language: string, disabled = false) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(END_QUIZ_BUTTON_ID)
      .setLabel(message(language, "endQuizButton"))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
  if (disabled) row.addComponents(myQuizButton(language, undefined, true));
  return [row];
}

export async function disablePollControls(client: Client, channelId: string, messageId: string, language: string) {
  try {
    await client.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: { components: pollControls(language, true).map(row => row.toJSON()), allowed_mentions: { parse: [] } }
    });
  } catch (error) {
    console.warn("Quiz button update failed:", privateErrorSummary(error));
  }
}
