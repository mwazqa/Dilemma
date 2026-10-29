import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type InteractionEditReplyOptions } from "discord.js";
import { getGuildSettings } from "./services/guild-settings.js";
import { message, normalizeLanguage, type MessageKey } from "./messages.js";
import { textPages } from "./formatting.js";

const interactionLanguages = new WeakMap<object, string>();
export function interactionLanguage(interaction: { locale: string }): string {
  return interactionLanguages.get(interaction) ?? normalizeLanguage(interaction.locale);
}
export function rememberLanguage(interaction: object, language: string) {
  interactionLanguages.set(interaction, normalizeLanguage(language));
}
export async function openFeedback(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = interaction.guildId
    ? await getGuildSettings(interaction.guildId)
    : null;
  const language = normalizeLanguage(settings?.language ?? interaction.locale);
  rememberLanguage(interaction, language);
  const reply = (payload: string | InteractionEditReplyOptions) => {
    const options = typeof payload === "string" ? { content: payload } : payload;
    return interaction.editReply({ ...options, content: options.content === null ? null : options.content?.slice(0, 2000), allowedMentions: { parse: [] } });
  };
  return {
    language,
    settings,
    text: (key: MessageKey, values?: Record<string, string | number>) => message(language, key, values),
    reply,
    replyBlocks: async (blocks: string[]) => {
      const pages = textPages(blocks);
      if (!pages.length) return;
      await reply(pages[0]);
      for (const content of pages.slice(1)) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      }
    }
  };
}
