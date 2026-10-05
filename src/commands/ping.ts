import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether Dylematic is online.");

export async function handlePing(interaction: ChatInputCommandInteraction) {
  await interaction.reply("Pong! Dylematic is online.");
}
