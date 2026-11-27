import {
  SlashCommandSubcommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { message } from "../messages.js";
import { isSupportedLanguage, supportedLanguages } from "../languages.js";
import { cacheGuildSettings, getGuildSettings } from "../services/guild-settings.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { guildTimezone, parseTimezone, timezoneSuggestions } from "../services/timezone.js";
import { scheduleEvents } from "../services/schedule-events.js";

export { supportedLanguages } from "../languages.js";

export const languageCommand = new SlashCommandSubcommandBuilder()
  .setName("language")
  .setDescription("Set language for bot messages and new quizzes.")
  .setDescriptionLocalizations({ pl: "Ustaw język wiadomości bota i nowych quizów." })
  .addStringOption((option) => option
    .setName("value")
    .setDescription("Server language.")
    .setDescriptionLocalizations({ pl: "Język serwera." })
    .setRequired(true)
    .addChoices(...supportedLanguages));

export const timezoneCommand = new SlashCommandSubcommandBuilder()
  .setName("timezone")
  .setDescription("Show or set timezone for schedules and daily limits.")
  .setDescriptionLocalizations({ pl: "Pokaż lub ustaw strefę dla harmonogramów i limitów dziennych." })
  .addStringOption(option => option.setName("value").setDescription("IANA timezone, for example Europe/London. Omit to show current timezone.")
    .setDescriptionLocalizations({ pl: "Strefa IANA, np. Europe/Warsaw. Pomiń, aby pokazać obecną." })
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
    if (!isSupportedLanguage(language)) { await reply(text("languageUnavailable")); return; }
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
