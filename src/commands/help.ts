import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show Dilemma commands.");

export function getHelpContent(): string {
  return [
    "**Dilemma commands**",
    "`/dilemma create` — create a quiz topic",
    "`/dilemma configure` — set interval, question count and generation time",
    "`/dilemma enable` / `/dilemma disable` — control automatic generation",
    "`/dilemma run` — generate questions now",
    "`/dilemma list` — show configured topics",
    "`/dilemma rename` / `/dilemma delete` — manage topics",
    "`/settings` — set server language and defaults",
    "`/poll end` — close a poll and publish its result"
  ].join("\n");
}

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    ephemeral: true,
    content: getHelpContent()
  });
}
