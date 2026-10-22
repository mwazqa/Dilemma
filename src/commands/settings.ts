import {
  SlashCommandSubcommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { message } from "../messages.js";
import { cacheGuildSettings, getGuildSettings } from "../services/guild-settings.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { guildTimezone, parseTimezone, timezoneSuggestions } from "../services/timezone.js";
import { scheduleEvents } from "../services/schedule-events.js";

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

export const timezoneCommand = new SlashCommandSubcommandBuilder()
  .setName("timezone")
  .setDescription("Show or set the server timezone for schedules and daily quiz limits.")
  .addStringOption(option => option.setName("value").setDescription("IANA timezone, such as Europe/London; omit to show the current timezone.")
    .setAutocomplete(true).setMinLength(1).setMaxLength(100));

export async function handleSettings(interaction: ChatInputCommandInteraction) {
  const { settings: currentSettings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  if (!canManageDilemma(interaction, currentSettings)) {
    await reply(text("permission"));
    return;
  }

  if (interaction.options.getSubcommand() === "language") {
    const language = interaction.options.getString("value", true);
    cacheGuildSettings(await db.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId, language },
      update: { language }
    }));
    await reply(message(language, "languageSet", { language: supportedLanguages.find(item => item.value === language)?.name ?? language }));
    return;
  }

  const requested = interaction.options.getString("value");
  if (requested === null) { await reply(text("timezoneCurrent", { timezone: guildTimezone(currentSettings) })); return; }
  const timezone = parseTimezone(requested);
  if (!timezone) { await reply(text("timezoneInvalid")); return; }
  const settings = cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, timezone }, update: { timezone }
  }));
  scheduleEvents.emit("guildTimezoneChanged", interaction.guildId, guildTimezone(settings));
  await reply(text("timezoneSet", { timezone: guildTimezone(settings) }));
}

export async function handleTimezoneAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId || !canManageDilemma(interaction, await getGuildSettings(interaction.guildId))) {
    await interaction.respond([]); return;
  }
  await interaction.respond(timezoneSuggestions(String(interaction.options.getFocused())));
}
