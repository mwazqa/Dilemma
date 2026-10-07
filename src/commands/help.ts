import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { message, type MessageKey } from "../messages.js";
import { openFeedback } from "../feedback.js";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show Dilemma commands.");

export function getHelpContent(language = "en"): string {
  const lines: [string, MessageKey][] = [
    ["/dilemma create", "helpCreate"], ["/dilemma configure", "helpConfigure"],
    ["/dilemma enable` / `/dilemma disable", "helpToggle"], ["/dilemma run", "helpRun"],
    ["/dilemma random", "helpRandom"], ["/dilemma list", "helpList"],
    ["/dilemma rename` / `/dilemma delete", "helpManage"], ["/settings", "helpSettings"], ["/poll end", "helpPoll"], ["/score", "helpScore"]
  ];
  return [message(language, "helpIntro"), ...lines.map(([command, key]) => `\`${command}\` - ${message(language, key)}`)].join("\n");
}

export function getHelpEmbed(language = "en"): EmbedBuilder {
  const sections: { title: MessageKey; commands: [string, MessageKey][] }[] = [
    { title: "helpQuizzes", commands: [
      ["/dilemma random", "helpRandom"], ["/dilemma run", "helpRun"], ["/poll end", "helpPoll"]
    ] },
    { title: "helpTopics", commands: [
      ["/dilemma create", "helpCreate"], ["/dilemma configure", "helpConfigure"],
      ["/dilemma enable` / `/dilemma disable", "helpToggle"], ["/dilemma list", "helpList"],
      ["/dilemma rename` / `/dilemma delete", "helpManage"]
    ] },
    { title: "helpSettingsScores", commands: [["/settings", "helpSettings"], ["/score", "helpScore"]] }
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
