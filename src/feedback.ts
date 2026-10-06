import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { db } from "./db.js";
import { message, normalizeLanguage, type MessageKey } from "./messages.js";

const interactionLanguages = new WeakMap<object, string>();
export function interactionLanguage(interaction: { locale: string }): string {
  return interactionLanguages.get(interaction) ?? normalizeLanguage(interaction.locale);
}
export function rememberLanguage(interaction: object, language: string) {
  interactionLanguages.set(interaction, normalizeLanguage(language));
}
export async function openFeedback(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = interaction.guildId
    ? await db.guildSettings.findUnique({ where: { guildId: interaction.guildId } })
    : null;
  const language = normalizeLanguage(settings?.language ?? interaction.locale);
  rememberLanguage(interaction, language);
  return {
    language,
    settings,
    text: (key: MessageKey, values?: Record<string, string | number>) => message(language, key, values),
    reply: (content: string) => interaction.editReply({ content: content.slice(0, 2000), allowedMentions: { parse: [] } })
  };
}
