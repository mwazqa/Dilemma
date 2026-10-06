import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import { db } from "../db.js";

export const supportedLanguages = [
  { name: "English", value: "en" },
  { name: "Polski", value: "pl" },
  { name: "Deutsch", value: "de" },
  { name: "Español", value: "es" },
  { name: "Français", value: "fr" },
  { name: "日本語", value: "ja" }
];

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure Dilemma for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand((subcommand) => subcommand
    .setName("language")
    .setDescription("Set the default language for new questions.")
    .addStringOption((option) => option
      .setName("value")
      .setDescription("Default question language.")
      .setRequired(true)
      .addChoices(...supportedLanguages)))
  .addSubcommand((subcommand) => subcommand
    .setName("defaults")
    .setDescription("Set default AI generation settings for new topics.")
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Days between generations.").setRequired(true).setMinValue(1).setMaxValue(30))
    .addIntegerOption((option) => option.setName("questions_per_run").setDescription("Questions generated each time.").setRequired(true).setMinValue(1).setMaxValue(20)));

export async function handleSettings(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command works only inside a server.", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "Manage Server permission required.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  if (interaction.options.getSubcommand() === "language") {
    const language = interaction.options.getString("value", true);
    await db.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId, language },
      update: { language }
    });
    await interaction.editReply({ content: `Default Dilemma language set to **${language}**.` });
    return;
  }

  const intervalDays = interaction.options.getInteger("interval_days", true);
  const questionsPerRun = interaction.options.getInteger("questions_per_run", true);
  await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, defaultIntervalDays: intervalDays, defaultQuestionsPerRun: questionsPerRun },
    update: { defaultIntervalDays: intervalDays, defaultQuestionsPerRun: questionsPerRun }
  });
  await interaction.editReply({ content: `Defaults set: every ${intervalDays} day(s), ${questionsPerRun} question(s) per AI run.` });
}
