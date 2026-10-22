import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { handleHelp } from "./help.js";
import { handlePing, pingCommand } from "./ping.js";
import { handlePoll, pollCommand } from "./poll.js";
import { handleScore, handleScoreAutocomplete, scoreCommand } from "./score.js";
import { defaultsCommand, handleSettings, languageCommand } from "./settings.js";
import { handleTopic, handleTopicAutocomplete, topicCommand } from "./topic.js";
import { handlePermissions, permissionsCommand } from "./permissions.js";

export const dilemmaCommand = topicCommand
  .setDescription("Dilemma quizzes, profile, leaderboard and server settings.")
  .addSubcommand(languageCommand)
  .addSubcommand(defaultsCommand)
  .addSubcommand(pingCommand)
  .addSubcommandGroup(scoreCommand)
  .addSubcommandGroup(pollCommand)
  .addSubcommandGroup(permissionsCommand);

const commandOrder = ["random", "score", "create", "configure", "list", "run", "enable", "disable", "language", "defaults", "permissions", "poll", "help", "ping", "delete"];
dilemmaCommand.options.sort((first, second) => commandOrder.indexOf(first.toJSON().name) - commandOrder.indexOf(second.toJSON().name));

export async function routeCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName !== "dilemma") return;
  const group = interaction.options.getSubcommandGroup(false);
  if (group === "score") { await handleScore(interaction); return; }
  if (group === "poll") { await handlePoll(interaction); return; }
  if (group === "permissions") { await handlePermissions(interaction); return; }
  if (group !== null) { await handleHelp(interaction); return; }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "language" || subcommand === "defaults") { await handleSettings(interaction); return; }
  if (subcommand === "ping") { await handlePing(interaction); return; }
  if (subcommand === "help") { await handleHelp(interaction); return; }
  await handleTopic(interaction);
}

export async function routeAutocomplete(interaction: AutocompleteInteraction) {
  if (interaction.commandName !== "dilemma") return;
  const group = interaction.options.getSubcommandGroup(false);
  if (group === "score") { await handleScoreAutocomplete(interaction); return; }
  if (group === null) { await handleTopicAutocomplete(interaction); return; }
  await interaction.respond([]);
}
