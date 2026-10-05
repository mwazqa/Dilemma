import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether Dilemma is online.");

export async function handlePing(interaction: ChatInputCommandInteraction) {
  await interaction.reply("Pong! Dilemma is online.");
}
