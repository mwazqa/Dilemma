import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction
} from "discord.js";
import { env } from "./config.js";
import { handlePing } from "./commands/ping.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log("Logged in as " + readyClient.user.tag);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await routeCommand(interaction);
  } catch (error) {
    console.error(error);
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
}

process.on("SIGINT", () => client.destroy());
process.on("SIGTERM", () => client.destroy());

await client.login(env.DISCORD_TOKEN);
