import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { env } from "./config.js";
import { db } from "./db.js";
import { handlePing } from "./commands/ping.js";
import { handleSettings, supportedLanguages } from "./commands/settings.js";
import { handleTopic, handleTopicAutocomplete } from "./commands/topic.js";
import { handlePoll } from "./commands/poll.js";
import { handleHelp } from "./commands/help.js";
import { startScheduler } from "./scheduler.js";
import { interactionLanguage, rememberLanguage } from "./feedback.js";
import { message } from "./messages.js";
import { startScoreScheduler } from "./services/scoring.js";
import { handleScore } from "./commands/score.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log("Logged in as " + readyClient.user.tag);
  startScheduler(client);
  startScoreScheduler(client);
});

client.on(Events.GuildCreate, async (guild) => {
  await db.guildSettings.upsert({
    where: { guildId: guild.id },
    create: { guildId: guild.id },
    update: {}
  });

  const channel = guild.systemChannel ?? guild.channels.cache.find((candidate) =>
    candidate.isTextBased() && guild.members.me && candidate.permissionsFor(guild.members.me)?.has("SendMessages")
  );
  if (!channel?.isTextBased()) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("settings:language")
    .setPlaceholder("Choose question language")
    .addOptions(supportedLanguages.map((language) => ({
      label: language.name,
      value: language.value
    })));

  await channel.send({
    content: "Your little quiz companion is ready~ Choose your server's language! (≧◡≦) ♡",
    allowedMentions: { parse: [] },
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "dilemma") await handleTopicAutocomplete(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "settings:language") {
      await handleLanguageSelection(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) await routeCommand(interaction);
  } catch (error) {
    console.error("Interaction failed:", error instanceof Error ? error.name : "unknown");
    if (!interaction.isRepliable()) return;
    const content = message(interactionLanguage(interaction), "error");
    if (interaction.isChatInputCommand() && interaction.deferred) {
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } else if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }
});

async function routeCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") await handlePing(interaction);
  if (interaction.commandName === "dilemma") await handleTopic(interaction);
  if (interaction.commandName === "settings") await handleSettings(interaction);
  if (interaction.commandName === "poll") await handlePoll(interaction);
  if (interaction.commandName === "help") await handleHelp(interaction);
  if (interaction.commandName === "score") await handleScore(interaction);
}

async function handleLanguageSelection(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: message(interactionLanguage(interaction), "permission"), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const language = interaction.values[0];
  if (!supportedLanguages.some(item => item.value === language)) throw new Error("Unsupported language selection");
  rememberLanguage(interaction, language);
  await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, language },
    update: { language }
  });
  await interaction.editReply({
    content: message(language, "languageSet", { language: supportedLanguages.find(item => item.value === language)!.name }),
    components: []
  });
}

process.on("SIGINT", () => client.destroy());
process.on("SIGTERM", () => client.destroy());

await client.login(env.DISCORD_TOKEN);
