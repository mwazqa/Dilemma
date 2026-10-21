import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { message, type MessageKey } from "../messages.js";
import { openFeedback } from "../feedback.js";

export function getHelpContent(language = "en"): string {
  const embed = getHelpEmbed(language).toJSON();
  return [embed.title, embed.description, ...(embed.fields ?? []).flatMap(field => [field.name, field.value])].join("\n");
}

export function getHelpEmbed(language = "en"): EmbedBuilder {
  const sections: { title: MessageKey; commands: [string, MessageKey][] }[] = [
    { title: "helpQuizzes", commands: [
      ["/dilemma random", "helpRandom"], ["/dilemma run", "helpRun"], ["/dilemma poll end", "helpPoll"]
    ] },
    { title: "helpTopics", commands: [
      ["/dilemma create", "helpCreate"], ["/dilemma configure", "helpConfigure"],
      ["/dilemma list", "helpList"], ["/dilemma enable` / `/dilemma disable", "helpToggle"],
      ["/dilemma delete", "helpManage"]
    ] },
    { title: "helpSettingsScores", commands: [["/dilemma language", "helpLanguage"], ["/dilemma defaults", "helpDefaults"],
      ["/dilemma score profile", "helpProfile"], ["/dilemma score leaderboard", "helpLeaderboard"],
      ["/dilemma score achievements", "helpAchievements"], ["/dilemma score badge", "helpBadge"],
      ["/dilemma ping", "helpPing"], ["/dilemma score forget", "helpForget"]] }
  ];
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(message(language, "helpIntro"))
    .setDescription(`${message(language, "helpSchedule")}\n\n${message(language, "helpAnswers")}`)
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
