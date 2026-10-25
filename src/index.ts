import { privateErrorSummary } from "./private-errors.js";
import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction
} from "discord.js";
import { env } from "./config.js";
import { db } from "./db.js";
import { supportedLanguages } from "./commands/settings.js";
import { guildTimezone } from "./services/timezone.js";
import { handleEndPollButton } from "./commands/poll.js";
import { routeAutocomplete, routeCommand } from "./commands/dilemma.js";
import { startScheduler } from "./scheduler.js";
import { interactionLanguage, rememberLanguage } from "./feedback.js";
import { message } from "./messages.js";
import { startScoreScheduler } from "./services/scoring.js";
import { END_QUIZ_BUTTON_ID } from "./services/poll-controls.js";
import { cacheGuildSettings } from "./services/guild-settings.js";
import { handleTopicListComponent, TOPIC_LIST_PREFIX } from "./commands/topic-list.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const stopSchedulers: (() => void)[] = [];
client.on(Events.Error, error => {
  console.error("Discord client error:", privateErrorSummary(error));
});

client.once(Events.ClientReady, (readyClient) => {
  console.log("Logged in as Discord bot");
  stopSchedulers.push(startScheduler(client), startScoreScheduler(client));
});

client.on(Events.GuildCreate, async (guild) => {
  const settings = cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: guild.id },
    create: { guildId: guild.id },
    update: {}
  }));

  const channel = guild.systemChannel ?? guild.channels.cache.find((candidate) =>
    candidate.isTextBased() && guild.members.me && candidate.permissionsFor(guild.members.me)?.has("SendMessages")
  );
  if (!channel?.isTextBased()) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("settings:language")
    .setPlaceholder(message(settings.language, "languagePlaceholder"))
    .addOptions(supportedLanguages.map((language) => ({
      label: language.name,
      value: language.value
    })));

  await channel.send({
    content: message(settings.language, "welcome"),
    allowedMentions: { parse: [] },
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await routeAutocomplete(interaction);
      return;
    }
    if (interaction.isMessageComponent() && interaction.customId.startsWith(TOPIC_LIST_PREFIX)) {
      await handleTopicListComponent(interaction); return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "settings:language") {
      await handleLanguageSelection(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === END_QUIZ_BUTTON_ID) {
      await handleEndPollButton(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) await routeCommand(interaction);
  } catch (error) {
    console.error("Interaction failed:", privateErrorSummary(error));
    if (!interaction.isRepliable()) return;
    const content = message(interactionLanguage(interaction), "error");
    try {
      if (interaction.isChatInputCommand() && interaction.deferred) {
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
      } else if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      }
    } catch (replyError) {
      console.error("Interaction error response failed:", privateErrorSummary(replyError));
    }
  }
});

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
  const settings = cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, language },
    update: { language }
  }));
  await interaction.editReply({
    content: message(language, "languageSet", { language: supportedLanguages.find(item => item.value === language)!.name }) +
      (settings.timezone ? "" : `\n\n${message(language, "timezoneSetup", { timezone: guildTimezone(settings) })}`),
    components: []
  });
}

function shutdown() {
  for (const stop of stopSchedulers) stop();
  client.destroy();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.login(env.DISCORD_TOKEN);
