import { SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { cacheGuildSettings } from "../services/guild-settings.js";
import { canManageDilemma, canResetRandomCooldown } from "../services/management-permissions.js";
import { scheduleEvents } from "../services/schedule-events.js";
import { openFeedback } from "../feedback.js";

export const randomResetCommand = new SlashCommandSubcommandBuilder()
  .setName("random-reset")
  .setDescription("Reset the random quiz cooldown; the daily limit stays unchanged.");

export const randomNotificationsCommand = new SlashCommandSubcommandGroupBuilder()
  .setName("random-notifications")
  .setDescription("Configure the role ping when another random quiz becomes available.")
  .addSubcommand(command => command.setName("set").setDescription("Set the role to ping when random is ready.")
    .addRoleOption(option => option.setName("role").setDescription("Role to notify when another random quiz is available.").setRequired(true)))
  .addSubcommand(command => command.setName("clear").setDescription("Turn off random availability pings."))
  .addSubcommand(command => command.setName("show").setDescription("Show the current random availability notification role."));

export async function handleRandomReset(interaction: ChatInputCommandInteraction) {
  const { settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  if (!canResetRandomCooldown(interaction, settings)) { await reply(text("randomResetPermission")); return; }
  const resetAt = new Date();
  const updated = cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, randomCooldownResetAt: resetAt },
    update: { randomCooldownResetAt: resetAt }
  }));
  scheduleEvents.emit("randomNotificationsChanged", updated.guildId);
  await reply(text("randomCooldownReset"));
}

export async function handleRandomNotifications(interaction: ChatInputCommandInteraction) {
  const { settings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId || !interaction.guild) { await reply(text("serverOnly")); return; }
  if (!canManageDilemma(interaction, settings)) { await reply(text("permission")); return; }
  const action = interaction.options.getSubcommand();
  if (action === "show") {
    await reply(settings?.randomPingRoleId ? text("randomPingCurrent", { role: `<@&${settings.randomPingRoleId}>` }) : text("randomPingUnset"));
    return;
  }
  let roleId: string | null = null;
  if (action === "set") {
    const selected = interaction.options.getRole("role", true);
    if (selected.id === interaction.guildId || !interaction.guild) { await reply(text("randomPingRoleInvalid")); return; }
    const role = await interaction.guild.roles.fetch(selected.id).catch(() => null);
    if (!role || role.id !== selected.id || role.guild.id !== interaction.guildId || role.id === interaction.guildId) {
      await reply(text("randomPingRoleInvalid")); return;
    }
    roleId = role.id;
  } else if (action !== "clear") return;
  const updated = cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, randomPingRoleId: roleId },
    update: { randomPingRoleId: roleId }
  }));
  if (roleId && roleId !== settings?.randomPingRoleId) {
    const latest = await db.randomPoll.findFirst({ where: { guildId: interaction.guildId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (latest) await db.randomPoll.updateMany({ where: { id: latest.id }, data: { readyPingSentAt: null } });
  }
  scheduleEvents.emit("randomNotificationsChanged", updated.guildId);
  await reply(roleId ? text("randomPingSet", { role: `<@&${roleId}>` }) : text("randomPingCleared"));
}
