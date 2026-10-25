import { ChannelType, PermissionsBitField } from "discord.js";

export function quizGuild(guildId = "guild", channels = []) {
  const fallback = { id: "channel", guildId, type: ChannelType.GuildText, isSendable: () => true,
    permissionsFor: () => new PermissionsBitField(PermissionsBitField.All) };
  return { id: guildId, members: { me: { id: "bot" } },
    channels: { fetch: async id => channels.find(channel => channel.id === id) ?? (id === fallback.id ? fallback : null) } };
}
