import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log("Logged in as " + readyClient.user.tag);
  startScheduler(client);
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
    content: "Dilemma is ready. Choose the default language for quiz questions:",
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
    console.error(error);
    if (!interaction.isRepliable()) return;
    const message = "Something went wrong. Please try again later.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

async function routeCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") await handlePing(interaction);
  if (interaction.commandName === "dilemma") await handleTopic(interaction);
  if (interaction.commandName === "settings") await handleSettings(interaction);
  if (interaction.commandName === "poll") await handlePoll(interaction);
  if (interaction.commandName === "help") await handleHelp(interaction);
}

async function handleLanguageSelection(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;
  const language = interaction.values[0];
  await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, language },
    update: { language }
  });
  await interaction.update({
    content: `Dilemma language set to **${language}**.`,
    components: []
  });
}

process.on("SIGINT", () => client.destroy());
process.on("SIGTERM", () => client.destroy());

await client.login(env.DISCORD_TOKEN);
