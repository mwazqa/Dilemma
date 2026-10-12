import "./private-errors.js";
import { REST, Routes } from "discord.js";
import { env } from "./config.js";
import { dilemmaCommand } from "./commands/dilemma.js";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
const commands = [dilemmaCommand.toJSON()];
if (env.DISCORD_REGISTER_GLOBAL || !env.DISCORD_GUILD_ID) {
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: [] });
  }
  console.log("Registered " + commands.length + " global command(s).");
} else {
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: commands });
  console.log("Registered " + commands.length + " guild command(s).");
}
