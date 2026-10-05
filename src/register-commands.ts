import { REST, Routes } from "discord.js";
import { env } from "./config.js";
import { pingCommand } from "./commands/ping.js";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
const commands = [pingCommand.toJSON()];
const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, { body: commands });
console.log("Registered " + commands.length + " command(s).");
