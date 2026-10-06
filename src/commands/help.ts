import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
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

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  const { language, reply } = await openFeedback(interaction);
  await reply(getHelpContent(language));
}
