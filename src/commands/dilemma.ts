import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { openFeedback } from "../feedback.js";
import { handleHelp } from "./help.js";
import { guideCommand, handleGuide } from "./guide.js";
import { handlePing, pingCommand } from "./ping.js";
import { endCommand, handlePoll } from "./poll.js";
import { achievementsCommand, badgesCommand, handleScore, handleScoreAutocomplete, leaderboardCommand, profileCommand, sparksCommand } from "./score.js";
import { timezoneCommand, handleTimezoneAutocomplete, handleSettings, languageCommand } from "./settings.js";
import { handleTopic, handleTopicAutocomplete, topicCommand, topicSubcommands } from "./topic.js";
import { handlePermissions, permissionsCommand } from "./permissions.js";
import { channelsCommand, handleChannels } from "./channels.js";
import { handleRandomNotifications, handleRandomReset, randomNotificationsCommand, randomResetCommand } from "./random-management.js";

export const dilemmaCommand = topicCommand
  .setDescription("Dilemma quizzes, profile, leaderboard and server settings.")
  .addSubcommand(languageCommand)
  .addSubcommand(timezoneCommand)
  .addSubcommand(pingCommand)
  .addSubcommand(profileCommand)
  .addSubcommand(leaderboardCommand)
  .addSubcommand(achievementsCommand)
  .addSubcommandGroup(badgesCommand)
  .addSubcommandGroup(sparksCommand)
  .addSubcommand(endCommand)
  .addSubcommandGroup(permissionsCommand)
  .addSubcommandGroup(channelsCommand)
  .addSubcommandGroup(randomNotificationsCommand)
  .addSubcommand(randomResetCommand)
  .addSubcommandGroup(guideCommand);

const commandOrder = ["random", "custom", "profile", "leaderboard", "achievements", "badges", "sparks", "end", "create", "edit", "list", "publish", "enable", "disable", "random-cooldown-reset", "random-channels", "random-notifications", "permissions", "guide", "help", "language", "timezone", "ping", "delete"];
dilemmaCommand.options.sort((first, second) => commandOrder.indexOf(first.toJSON().name) - commandOrder.indexOf(second.toJSON().name));

async function unavailableCommand(interaction: ChatInputCommandInteraction) {
  const { text, reply } = await openFeedback(interaction);
  await reply(text("commandUnavailable"));
}

export async function routeCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName !== "dilemma") return;
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  if (group === "sparks" && (subcommand === "exchange" || subcommand === "transfer")) { await handleScore(interaction); return; }
  if (group === "badges" && subcommand === "set") { await handleScore(interaction, "badge"); return; }
  if (group === "guide" && subcommand === "publish") { await handleGuide(interaction); return; }
  if (group === "permissions") { await handlePermissions(interaction); return; }
  if (group === "random-channels") { await handleChannels(interaction); return; }
  if (group === "random-notifications") { await handleRandomNotifications(interaction); return; }
  if (group !== null) { await unavailableCommand(interaction); return; }
  if (["profile", "leaderboard", "achievements"].includes(subcommand)) { await handleScore(interaction); return; }
  if (subcommand === "end") { await handlePoll(interaction); return; }
  if (subcommand === "random-cooldown-reset") { await handleRandomReset(interaction); return; }
  if (subcommand === "language" || subcommand === "timezone") { await handleSettings(interaction); return; }
  if (subcommand === "ping") { await handlePing(interaction); return; }
  if (subcommand === "help") { await handleHelp(interaction); return; }
  if (topicSubcommands.has(subcommand)) { await handleTopic(interaction); return; }
  await unavailableCommand(interaction);
}

export async function routeAutocomplete(interaction: AutocompleteInteraction) {
  if (interaction.commandName !== "dilemma") return;
  const group = interaction.options.getSubcommandGroup(false);
  if (group === "badges" && interaction.options.getSubcommand() === "set") { await handleScoreAutocomplete(interaction); return; }
  if (group === null && interaction.options.getSubcommand() === "timezone") { await handleTimezoneAutocomplete(interaction); return; }
  if (group === null && topicSubcommands.has(interaction.options.getSubcommand())) { await handleTopicAutocomplete(interaction); return; }
  await interaction.respond([]);
}
