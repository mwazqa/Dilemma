import {
  PermissionFlagsBits,
  SlashCommandSubcommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import { db } from "../db.js";
import { difficultyOption, parseDifficulty } from "../difficulty.js";
import { openFeedback } from "../feedback.js";
import { message } from "../messages.js";
import { env } from "../config.js";
import { isGenerationTime } from "../services/quiz-limits.js";

export const supportedLanguages = [
  { name: "English", value: "en" },
  { name: "Polski", value: "pl" },
  { name: "Deutsch", value: "de" },
  { name: "Español", value: "es" },
  { name: "Français", value: "fr" },
  { name: "日本語", value: "ja" }
];

export const languageCommand = new SlashCommandSubcommandBuilder()
  .setName("language")
  .setDescription("Set the server language for all topics, questions and commands.")
  .addStringOption((option) => option
    .setName("value")
    .setDescription("Global server language.")
    .setRequired(true)
    .addChoices(...supportedLanguages));

export const defaultsCommand = new SlashCommandSubcommandBuilder()
  .setName("defaults")
  .setDescription("Set default AI generation settings for new topics and random quizzes.")
  .addIntegerOption((option) => option.setName("interval_days").setDescription("Days between generations.").setRequired(false).setMinValue(1).setMaxValue(30))
  .addIntegerOption((option) => option.setName("duration_hours").setDescription("Default poll duration in hours (1-24).").setRequired(false).setMinValue(1).setMaxValue(24))
  .addStringOption((option) => option.setName("generation_hours").setDescription("Default publication time HH:mm in the bot quiz timezone; new topics only.").setRequired(false).setMinLength(5).setMaxLength(5))
  .addStringOption(difficultyOption);

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

  const intervalDays = interaction.options.getInteger("interval_days");
  const durationHours = interaction.options.getInteger("duration_hours");
  const requestedDifficulty = interaction.options.getString("difficulty");
  const generationTime = interaction.options.getString("generation_hours")?.trim() ?? null;
  if (intervalDays === null && durationHours === null && requestedDifficulty === null && generationTime === null) {
    await reply(text("settingsMissing"));
    return;
  }
  if (generationTime !== null && !isGenerationTime(generationTime)) {
    await reply(text("timeInvalid"));
    return;
  }
  const settings = await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, defaultIntervalDays: intervalDays ?? 1, defaultPollDurationHours: durationHours ?? 24,
      defaultGenerationTime: generationTime,
      defaultDifficulty: parseDifficulty(requestedDifficulty) },
    update: { ...(intervalDays === null ? {} : { defaultIntervalDays: intervalDays }),
      ...(durationHours === null ? {} : { defaultPollDurationHours: durationHours }),
      ...(generationTime === null ? {} : { defaultGenerationTime: generationTime }),
      ...(requestedDifficulty === null ? {} : { defaultDifficulty: parseDifficulty(requestedDifficulty) }) }
  });
  await reply(text("defaultsSet", { days: settings.defaultIntervalDays, hours: settings.defaultPollDurationHours,
    time: settings.defaultGenerationTime ?? text("scheduleUnset"), timezone: env.QUIZ_TIMEZONE,
    difficulty: message(currentLanguage, parseDifficulty(settings.defaultDifficulty)) }));
}
