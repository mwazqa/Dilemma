import { PermissionFlagsBits, SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { publishRandomQuestion, publishTopicQuestions } from "../services/poll-publisher.js";
import { getHelpContent } from "./help.js";

export const dilemmaCommand = new SlashCommandBuilder()
  .setName("dilemma")
  .setDescription("Configure Dilemma quiz topics.")
  .addSubcommand((subcommand) => subcommand
    .setName("create")
    .setDescription("Create or update a quiz topic using server defaults.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((option) => option.setName("options").setDescription("Optional: answers separated by commas. If empty, AI creates them.").setRequired(false).setMaxLength(500))
    .addIntegerOption((option) => option.setName("option_count").setDescription("Required only when options is empty: number of AI-created answers.").setRequired(false).setMinValue(2).setMaxValue(4)))
  .addSubcommand((subcommand) => subcommand
    .setName("configure")
    .setDescription("Override generation settings for one topic.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Optional: days between AI generations.").setRequired(false).setMinValue(1).setMaxValue(30))
    .addIntegerOption((option) => option.setName("questions_per_run").setDescription("Optional: questions generated each time.").setRequired(false).setMinValue(1).setMaxValue(20))
    .addStringOption((option) => option.setName("generation_time").setDescription("Optional local time, HH:mm, for automatic generation.").setRequired(false).setMaxLength(5)))
  .addSubcommand((subcommand) => subcommand
    .setName("enable")
    .setDescription("Enable automatic generation for a topic.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("disable")
    .setDescription("Disable automatic generation for a topic.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("delete")
    .setDescription("Delete a quiz topic configuration.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("rename")
    .setDescription("Rename a quiz topic.")
    .addStringOption((option) => option.setName("old_name").setDescription("Current topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((option) => option.setName("new_name").setDescription("New topic name.").setRequired(true).setMaxLength(80)))
  .addSubcommand((subcommand) => subcommand
    .setName("list")
    .setDescription("List quiz topics for this server."))
  .addSubcommand((subcommand) => subcommand
    .setName("help")
    .setDescription("Show Dilemma commands."))
  .addSubcommand((subcommand) => subcommand
    .setName("random")
    .setDescription("Generate one random dilemma now.")
    .addIntegerOption((option) => option
      .setName("option_count")
      .setDescription("Number of AI-generated answers.")
      .setRequired(true)
      .setMinValue(2)
      .setMaxValue(4)))
  .addSubcommand((subcommand) => subcommand
    .setName("run")
    .setDescription("Generate questions now with AI.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true)));

export async function handleTopic(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command works only inside a server.", ephemeral: true });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help") {
    await interaction.reply({ content: getHelpContent(), ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "Manage Server permission required.", ephemeral: true });
    return;
  }

  if (subcommand === "list") {
    const topics = await db.topic.findMany({ where: { guildId: interaction.guildId }, orderBy: { name: "asc" } });
    const lines = topics.map((topic) =>
      `• **${topic.name}** — ${topic.enabled ? "on" : "off"}, every ${topic.intervalDays} day(s), ${topic.questionsPerRun} question(s), at ${topic.generationTime ?? "server default"}, ${topic.options || `AI chooses ${topic.optionCount}`}`
    );
    await interaction.reply({ content: lines.length ? lines.join("\n") : "No topics configured yet.", ephemeral: true });
    return;
  }

  if (subcommand === "random") {
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await interaction.reply({ content: "This channel cannot receive questions.", ephemeral: true });
      return;
    }
    const settings = await db.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId },
      update: {}
    });
    const optionCount = interaction.options.getInteger("option_count", true);
    await interaction.deferReply({ ephemeral: true });
    try {
      const generatedTopic = await publishRandomQuestion(interaction.guildId, settings.language, optionCount, channel);
      await interaction.editReply(`Random dilemma generated: **${generatedTopic}** with ${optionCount} option(s).`);
    } catch (error) {
      if (isOpenAIQuotaError(error)) {
        await interaction.editReply("AI is unavailable: OpenRouter credits or limits were exhausted. Try again later.");
        return;
      }
      throw error;
    }
    return;
  }

  if (subcommand === "rename") {
    const oldName = interaction.options.getString("old_name", true).trim();
    const newName = interaction.options.getString("new_name", true).trim();
    const topic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name: oldName } } });
    if (!topic) {
      await interaction.reply({ content: `Topic **${oldName}** does not exist.`, ephemeral: true });
      return;
    }
    const existing = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name: newName } } });
    if (existing) {
      await interaction.reply({ content: `Topic **${newName}** already exists.`, ephemeral: true });
      return;
    }
    await db.topic.update({ where: { id: topic.id }, data: { name: newName } });
    await interaction.reply({ content: `Topic renamed from **${oldName}** to **${newName}**.`, ephemeral: true });
    return;
  }

  const name = interaction.options.getString("name", true).trim();
  const settings = await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId },
    update: {}
  });

  if (subcommand === "create") {
    const rawOptions = interaction.options.getString("options")?.trim() ?? "";
    const requestedOptionCount = interaction.options.getInteger("option_count");
    const options = rawOptions ? parseOptions(rawOptions) : null;
    if (rawOptions && !options) {
      await interaction.reply({ content: "Provide 2 to 4 answers separated by commas.", ephemeral: true });
      return;
    }
    if (options && requestedOptionCount !== null && requestedOptionCount !== options.length) {
      await interaction.reply({ content: "When options are provided, option_count must match their number.", ephemeral: true });
      return;
    }
    if (!options && requestedOptionCount === null) {
      await interaction.reply({ content: "Leave options empty and provide option_count from 2 to 4.", ephemeral: true });
      return;
    }
    const optionCount = options?.length ?? requestedOptionCount!;
    const topic = await db.topic.upsert({
      where: { guildId_name: { guildId: interaction.guildId, name } },
      create: {
        guildId: interaction.guildId,
        name,
        language: settings.language,
        intervalDays: settings.defaultIntervalDays,
        questionsPerRun: settings.defaultQuestionsPerRun,
        options: options?.join(", ") ?? "",
        optionCount,
        channelId: interaction.channelId
      },
      update: { language: settings.language, options: options?.join(", ") ?? "", optionCount, channelId: interaction.channelId, enabled: true }
    });
    await interaction.reply({ content: `Topic **${topic.name}** saved. ${options ? `Uses ${options.length} provided options.` : `AI will create ${optionCount} options.`} Defaults: every ${topic.intervalDays} day(s), ${topic.questionsPerRun} question(s).`, ephemeral: true });
    return;
  }

  const topic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name } } });
  if (!topic) {
    await interaction.reply({ content: `Topic **${name}** does not exist.`, ephemeral: true });
    return;
  }

  if (subcommand === "delete") {
    await db.topic.delete({ where: { id: topic.id } });
    await interaction.reply({ content: `Topic **${name}** deleted.`, ephemeral: true });
    return;
  }

  if (subcommand === "run") {
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await interaction.reply({ content: "This channel cannot receive questions.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await publishTopicQuestions(topic, channel);
    } catch (error) {
      if (isOpenAIQuotaError(error)) {
        await interaction.editReply("AI is unavailable: OpenAI API credits are exhausted. Add credits, then run this command again.");
        return;
      }
      throw error;
    }
    await interaction.editReply(`Generated and published ${topic.questionsPerRun} question(s) for **${topic.name}**.`);
    return;
  }

  if (subcommand === "configure") {
    const intervalDays = interaction.options.getInteger("interval_days");
    const questionsPerRun = interaction.options.getInteger("questions_per_run");
    const generationTime = interaction.options.getString("generation_time")?.trim() || null;
    if (intervalDays === null && questionsPerRun === null && generationTime === null) {
      await interaction.reply({ content: "Provide at least one setting to change.", ephemeral: true });
      return;
    }
    if (generationTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(generationTime)) {
      await interaction.reply({ content: "generation_time must use HH:mm format, for example 18:30.", ephemeral: true });
      return;
    }
    const updatedTopic = await db.topic.update({
      where: { id: topic.id },
      data: {
        ...(intervalDays === null ? {} : { intervalDays }),
        ...(questionsPerRun === null ? {} : { questionsPerRun }),
        ...(generationTime === null ? {} : { generationTime }),
        ...(generationTime !== null && generationTime !== topic.generationTime ? { lastGeneratedAt: null } : {}),
        enabled: true
      }
    });
    await interaction.reply({ content: `Topic **${name}** configured: every ${updatedTopic.intervalDays} day(s), ${updatedTopic.questionsPerRun} question(s)${updatedTopic.generationTime ? ` at ${updatedTopic.generationTime}` : ""}.`, ephemeral: true });
    return;
  }

  const enabled = subcommand === "enable";
  await db.topic.update({ where: { id: topic.id }, data: { enabled } });
  await interaction.reply({ content: `Topic **${name}** ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
}

export async function handleTopicAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== "name" && focused.name !== "old_name") {
    await interaction.respond([]);
    return;
  }
  const query = String(focused.value).toLowerCase();
  const topics = await db.topic.findMany({
    where: {
      guildId: interaction.guildId,
      name: { contains: query }
    },
    orderBy: { name: "asc" },
    take: 25
  });
  await interaction.respond(topics.map((topic) => ({ name: topic.name, value: topic.name })));
}

function parseOptions(value: string): string[] | null {
  const options = value.split(",").map((option) => option.trim()).filter(Boolean);
  return options.length >= 2 && options.length <= 4 ? options : null;
}

function isOpenAIQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: number; code?: string };
  return apiError.status === 429 || apiError.code === "insufficient_quota" || apiError.code === "credit_balance_exhausted";
}
