import { SlashCommandSubcommandGroupBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { cacheGuildSettings } from "../services/guild-settings.js";
import { canConfigureManagement, canManageDilemma } from "../services/management-permissions.js";

export const permissionsCommand = new SlashCommandSubcommandGroupBuilder()
  .setName("permissions")
  .setDescription("Configure the server role allowed to manage Dilemma.")
  .addSubcommand(command => command.setName("show").setDescription("Show the configured Dilemma management role."))
  .addSubcommand(command => command.setName("set").setDescription("Set a management role; requires Manage Server.")
    .addRoleOption(option => option.setName("role").setDescription("Existing server role allowed to manage Dilemma.").setRequired(true)))
  .addSubcommand(command => command.setName("clear").setDescription("Remove delegated management access; requires Manage Server."));

export async function handlePermissions(interaction: ChatInputCommandInteraction) {
  const { settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  const action = interaction.options.getSubcommand();
  if (action === "show") {
    if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
    await reply(settings?.managerRoleId ? text("managerRoleCurrent", { role: `<@&${settings.managerRoleId}>` }) : text("managerRoleUnset"));
    return;
  }
  if (!canConfigureManagement(interaction)) { await reply(text("managementAdminOnly")); return; }
  if (action !== "set" && action !== "clear") return;
  let roleId: string | null = null;
  if (action === "set") {
    const selected = interaction.options.getRole("role", true);
    if (selected.id === interaction.guildId || selected.managed || !interaction.guild) {
      await reply(text("managerRoleInvalid")); return;
    }
    try {
      const role = await interaction.guild.roles.fetch(selected.id);
      if (!role || role.id !== selected.id || role.guild.id !== interaction.guildId || role.managed || role.id === interaction.guildId) {
        await reply(text("managerRoleInvalid")); return;
      }
      roleId = role.id;
    } catch {
      await reply(text("managerRoleInvalid")); return;
    }
  }
  cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, managerRoleId: roleId },
    update: { managerRoleId: roleId }
  }));
  await reply(roleId ? text("managerRoleSet", { role: `<@&${roleId}>` }) : text("managerRoleCleared"));
}
