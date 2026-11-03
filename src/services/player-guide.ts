import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { message } from "../messages.js";
import { experiencePerPoint } from "./experience.js";
import { RANDOM_COOLDOWN_MS, RANDOM_DAILY_LIMIT, RANDOM_MAX_DURATION_HOURS } from "./quiz-limits.js";
import { FIFTY_FIFTY_COST, MAX_WAGER, REVEAL_COST, WITHDRAW_COST } from "./quiz-voting.js";

export const GUIDE_REFRESH_BUTTON_ID = "guide:refresh";

export function getPlayerGuideText(language = "en"): string {
  return message(language, "playerGuide", {
    myAnswerButton: message(language, "myQuizVoteButton"), quizJumpButton: message(language, "quizJumpButton"),
    wagerButton: message(language, "wagerButton"), myResultButton: message(language, "myQuizResultButton"),
    endQuizButton: message(language, "endQuizButton"),
    withdrawCost: WITHDRAW_COST, revealCost: REVEAL_COST,
    fiftyCost: FIFTY_FIFTY_COST, maxWager: MAX_WAGER, experiencePerPoint,
    randomDailyLimit: RANDOM_DAILY_LIMIT, randomCooldownHours: RANDOM_COOLDOWN_MS / 3_600_000,
    randomMaxHours: RANDOM_MAX_DURATION_HOURS
  });
}

export function getPlayerGuideEmbed(language = "en"): EmbedBuilder {
  return new EmbedBuilder().setColor(0xad94f3).setDescription(getPlayerGuideText(language));
}

export function getPlayerGuidePayload(language = "en") {
  return {
    embeds: [getPlayerGuideEmbed(language)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(GUIDE_REFRESH_BUTTON_ID).setLabel(message(language, "guideRefreshButton"))
        .setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}
