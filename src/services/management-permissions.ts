import { PermissionFlagsBits, type AutocompleteInteraction, type MessageComponentInteraction, type ChatInputCommandInteraction } from "discord.js";
import type { GuildSettings } from "@prisma/client";

type ManagementInteraction = AutocompleteInteraction | MessageComponentInteraction | ChatInputCommandInteraction;

export function canConfigureManagement(interaction: ManagementInteraction): boolean {
  return Boolean(interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

export function canManageDilemma(interaction: ManagementInteraction, settings: Pick<GuildSettings, "guildId" | "managerRoleId"> | null): boolean {
  if (!interaction.guildId) return false;
  if (canConfigureManagement(interaction)) return true;
  const roleId = settings?.guildId === interaction.guildId ? settings.managerRoleId : null;
  if (!roleId || roleId === interaction.guildId || !interaction.member) return false;
  if ("guild" in interaction.member && interaction.member.guild.id !== interaction.guildId) return false;
  const roles = interaction.member.roles;
  return Array.isArray(roles) ? roles.includes(roleId) : Boolean(roles?.cache?.has(roleId));
}
