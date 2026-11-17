import { EmbedBuilder } from "discord.js";
import { message } from "../messages.js";

export const LEGACY_GUIDE_REFRESH_BUTTON_ID = "guide:refresh";

export function getPlayerGuideText(language = "en"): string {
  return message(language, "playerGuide", {
    myAnswerButton: message(language, "myQuizVoteButton"), myResultButton: message(language, "myQuizResultButton"),
    reportQuizButton: message(language, "quizReportButton")
  });
}

export function getPlayerGuideEmbed(language = "en"): EmbedBuilder {
  return new EmbedBuilder().setColor(0xad94f3).setDescription(getPlayerGuideText(language));
}

export function getPlayerGuidePayload(language = "en") {
  return {
    embeds: [getPlayerGuideEmbed(language)],
    components: [],
    allowedMentions: { parse: [] }
  };
}
