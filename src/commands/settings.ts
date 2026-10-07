import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import { db } from "../db.js";
import { difficultyOption, parseDifficulty } from "../difficulty.js";
import { openFeedback } from "../feedback.js";
import { message } from "../messages.js";

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
    .setDescription("Set the server language for all topics, questions and commands.")
    .addStringOption((option) => option
      .setName("value")
      .setDescription("Global server language.")
      .setRequired(true)
      .addChoices(...supportedLanguages)))
  .addSubcommand((subcommand) => subcommand
    .setName("defaults")
    .setDescription("Set default AI generation settings for new topics.")
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Days between generations.").setRequired(true).setMinValue(1).setMaxValue(30))
    .addIntegerOption((option) => option.setName("duration_hours").setDescription("Default poll duration in hours (1-24).").setRequired(false).setMinValue(1).setMaxValue(24))
    .addStringOption(difficultyOption));

export async function handleSettings(interaction: ChatInputCommandInteraction) {
  const { language: currentLanguage, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(text("permission"));
    return;
  }

  if (interaction.options.getSubcommand() === "language") {
    const language = interaction.options.getString("value", true);
    await db.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId, language },
      update: { language }
    });
    await reply(message(language, "languageSet", { language: supportedLanguages.find(item => item.value === language)?.name ?? language }));
    return;
  }

  const intervalDays = interaction.options.getInteger("interval_days", true);
  const durationHours = interaction.options.getInteger("duration_hours");
  const requestedDifficulty = interaction.options.getString("difficulty");
  const settings = await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, defaultIntervalDays: intervalDays, defaultPollDurationHours: durationHours ?? 24,
      defaultDifficulty: parseDifficulty(requestedDifficulty) },
    update: { defaultIntervalDays: intervalDays,
      ...(durationHours === null ? {} : { defaultPollDurationHours: durationHours }),
      ...(requestedDifficulty === null ? {} : { defaultDifficulty: parseDifficulty(requestedDifficulty) }) }
  });
  await reply(text("defaultsSet", { days: intervalDays, hours: settings.defaultPollDurationHours, difficulty: message(currentLanguage, parseDifficulty(settings.defaultDifficulty)) }));
}
