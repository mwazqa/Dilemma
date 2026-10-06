import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { openFeedback } from "../feedback.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether Dilemma is online.");

export async function handlePing(interaction: ChatInputCommandInteraction) {
  const { text, reply } = await openFeedback(interaction);
  await reply(text("ping"));
}
