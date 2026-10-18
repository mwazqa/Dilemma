import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { message, type MessageKey } from "../messages.js";
import { openFeedback } from "../feedback.js";

export function getHelpContent(language = "en"): string {
  const lines: [string, MessageKey][] = [
    ["/dilemma create", "helpCreate"], ["/dilemma configure", "helpConfigure"],
    ["/dilemma enable` / `/dilemma disable", "helpToggle"], ["/dilemma run", "helpRun"],
    ["/dilemma random", "helpRandom"], ["/dilemma list", "helpList"],
    ["/dilemma delete", "helpManage"], ["/dilemma language", "helpLanguage"], ["/dilemma defaults", "helpDefaults"],
    ["/dilemma poll end", "helpPoll"], ["/dilemma score profile", "helpProfile"], ["/dilemma score leaderboard", "helpLeaderboard"],
    ["/dilemma score achievements", "helpAchievements"], ["/dilemma score badge", "helpBadge"],
    ["/dilemma score forget", "helpForget"], ["/dilemma ping", "helpPing"]
  ];
  return [message(language, "helpIntro"), ...lines.map(([command, key]) => `\`${command}\` - ${message(language, key)}`)].join("\n");
}

export function getHelpEmbed(language = "en"): EmbedBuilder {
  const sections: { title: MessageKey; commands: [string, MessageKey][] }[] = [
    { title: "helpQuizzes", commands: [
      ["/dilemma random", "helpRandom"], ["/dilemma run", "helpRun"], ["/dilemma poll end", "helpPoll"]
    ] },
    { title: "helpTopics", commands: [
      ["/dilemma create", "helpCreate"], ["/dilemma configure", "helpConfigure"],
      ["/dilemma enable` / `/dilemma disable", "helpToggle"], ["/dilemma list", "helpList"],
      ["/dilemma delete", "helpManage"]
    ] },
    { title: "helpSettingsScores", commands: [["/dilemma language", "helpLanguage"], ["/dilemma defaults", "helpDefaults"],
      ["/dilemma score profile", "helpProfile"], ["/dilemma score leaderboard", "helpLeaderboard"], ["/dilemma score forget", "helpForget"],
      ["/dilemma score achievements", "helpAchievements"], ["/dilemma score badge", "helpBadge"],
      ["/dilemma ping", "helpPing"]] }
  ];
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(message(language, "helpIntro"))
    .addFields(sections.map(section => ({
      name: message(language, section.title),
      value: section.commands.map(([command, key]) => `\`${command}\` - ${message(language, key)}`).join("\n"),
      inline: false
    })));
}

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  const { language, reply } = await openFeedback(interaction);
  await reply({ content: null, embeds: [getHelpEmbed(language)] });
}
