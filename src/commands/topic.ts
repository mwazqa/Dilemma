import { PermissionFlagsBits, SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { publishRandomQuestion, publishTopicQuestions } from "../services/poll-publisher.js";
import { getHelpEmbed } from "./help.js";
import { AiGenerationTimeoutError } from "../services/question-generator.js";
import { env } from "../config.js";
import { difficultyOption, parseDifficulty } from "../difficulty.js";
import { openFeedback } from "../feedback.js";
import { message } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";

export const dilemmaCommand = new SlashCommandBuilder()
  .setName("dilemma")
  .setDescription("Configure Dilemma quiz topics.")
  .addSubcommand((subcommand) => subcommand
    .setName("create")
    .setDescription("Create or update a quiz topic using server defaults.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((option) => option.setName("options").setDescription("Optional: answers separated by commas. If empty, AI creates them.").setRequired(false).setMaxLength(500))
    .addIntegerOption((option) => option.setName("option_count").setDescription("Required only when options is empty: number of AI-created answers.").setRequired(false).setMinValue(2).setMaxValue(4))
    .addStringOption(difficultyOption))
  .addSubcommand((subcommand) => subcommand
    .setName("configure")
    .setDescription("Override generation settings for one topic.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Optional: days between AI generations.").setRequired(false).setMinValue(1).setMaxValue(30))
    .addIntegerOption((option) => option.setName("questions_per_run").setDescription("Optional: questions generated each time.").setRequired(false).setMinValue(1).setMaxValue(20))
    .addStringOption((option) => option.setName("generation_time").setDescription("Optional local time, HH:mm, for automatic generation.").setRequired(false).setMaxLength(5))
    .addStringOption(difficultyOption))
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
      .setMaxValue(4))
    .addStringOption(difficultyOption))
  .addSubcommand((subcommand) => subcommand
    .setName("run")
    .setDescription("Generate questions now with AI.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true)));

export async function handleTopic(interaction: ChatInputCommandInteraction) {
  const { language, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help") {
    await reply({ content: null, embeds: [getHelpEmbed(language)] });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(text("permission"));
    return;
  }

  if (subcommand === "list") {
    const topics = await db.topic.findMany({ where: { guildId: interaction.guildId }, orderBy: { name: "asc" } });
    const lines = topics.map((topic) => topicSummary(topic, language));
    await reply(lines.length ? lines.join("\n") : text("emptyTopics"));
    return;
  }

  if (subcommand === "random") {
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await reply(text("channel"));
      return;
    }
    const settings = await db.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId },
      update: {}
    });
    const optionCount = interaction.options.getInteger("option_count", true);
    const difficulty = parseDifficulty(interaction.options.getString("difficulty") ?? settings.defaultDifficulty);
    const timeoutSeconds = Math.ceil(env.AI_GENERATION_TIMEOUT_MS / 1000);
    await reply(text("generating", { seconds: timeoutSeconds, difficulty: text(difficulty) }));
    try {
      const generatedTopic = await publishRandomQuestion(interaction.guildId, language, optionCount, channel, difficulty);
      await reply(text("randomDone", { name: generatedTopic, count: optionCount }));
    } catch (error) {
      if (error instanceof AiGenerationTimeoutError) {
        await reply(text("timeout"));
        return;
      }
      if (isOpenAIQuotaError(error)) {
        await reply(text("quota"));
        return;
      }
      console.error("Random dilemma failed:", privateErrorSummary(error));
      await reply(text("generationFailed"));
    }
    return;
  }

  if (subcommand === "rename") {
    const oldName = interaction.options.getString("old_name", true).trim();
    const newName = interaction.options.getString("new_name", true).trim();
    const topic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name: oldName } } });
    if (!topic) {
      await reply(text("missing", { name: oldName }));
      return;
    }
    const existing = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name: newName } } });
    if (existing) {
      await reply(text("exists", { name: newName }));
      return;
    }
    await db.topic.update({ where: { id: topic.id }, data: { name: newName } });
    await reply(text("renamed", { oldName, name: newName }));
    return;
  }

  const name = interaction.options.getString("name", true).trim();
  const settings = await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId },
    update: {}
  });

  if (subcommand === "create") {
    const requestedDifficulty = interaction.options.getString("difficulty");
    const rawOptions = interaction.options.getString("options")?.trim() ?? "";
    const requestedOptionCount = interaction.options.getInteger("option_count");
    const options = rawOptions ? parseOptions(rawOptions) : null;
    if (rawOptions && !options) {
      await reply(text("optionsInvalid"));
      return;
    }
    if (options && requestedOptionCount !== null && requestedOptionCount !== options.length) {
      await reply(text("optionsMismatch"));
      return;
    }
    if (!options && requestedOptionCount === null) {
      await reply(text("optionsMissing"));
      return;
    }
    const optionCount = options?.length ?? requestedOptionCount!;
    const topic = await db.topic.upsert({
      where: { guildId_name: { guildId: interaction.guildId, name } },
      create: {
        guildId: interaction.guildId,
        name,
        language: settings.language,
        difficulty: parseDifficulty(requestedDifficulty ?? settings.defaultDifficulty),
        intervalDays: settings.defaultIntervalDays,
        questionsPerRun: settings.defaultQuestionsPerRun,
        options: options?.join(", ") ?? "",
        optionCount,
        channelId: interaction.channelId
      },
      update: { language: settings.language, options: options?.join(", ") ?? "", optionCount, channelId: interaction.channelId, enabled: true,
        ...(requestedDifficulty === null ? {} : { difficulty: parseDifficulty(requestedDifficulty) }) }
    });
    await reply(text("saved", { name: topic.name, count: optionCount, difficulty: text(parseDifficulty(topic.difficulty)) }));
    return;
  }

  const topic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name } } });
  if (!topic) {
    await reply(text("missing", { name }));
    return;
  }

  if (subcommand === "delete") {
    await db.topic.delete({ where: { id: topic.id } });
    await reply(text("deleted", { name }));
    return;
  }

  if (subcommand === "run") {
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await reply(text("channel"));
      return;
    }

    await reply(text("generating", { seconds: Math.ceil(env.AI_GENERATION_TIMEOUT_MS / 1000), difficulty: text(parseDifficulty(topic.difficulty)) }));
    try {
      await publishTopicQuestions(topic, channel);
    } catch (error) {
      if (error instanceof AiGenerationTimeoutError) {
        await reply(text("timeout") + "\n" + text("partial"));
        return;
      }
      if (isOpenAIQuotaError(error)) {
        await reply(text("quota") + "\n" + text("partial"));
        return;
      }
      throw error;
    }
    await reply(text("runDone", { count: topic.questionsPerRun, name: topic.name }));
    return;
  }

  if (subcommand === "configure") {
    const intervalDays = interaction.options.getInteger("interval_days");
    const questionsPerRun = interaction.options.getInteger("questions_per_run");
    const generationTime = interaction.options.getString("generation_time")?.trim() || null;
    const difficulty = interaction.options.getString("difficulty");
    if (intervalDays === null && questionsPerRun === null && generationTime === null && difficulty === null) {
      await reply(text("settingsMissing"));
      return;
    }
    if (generationTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(generationTime)) {
      await reply(text("timeInvalid"));
      return;
    }
    const updatedTopic = await db.topic.update({
      where: { id: topic.id },
      data: {
        ...(intervalDays === null ? {} : { intervalDays }),
        ...(questionsPerRun === null ? {} : { questionsPerRun }),
        ...(generationTime === null ? {} : { generationTime }),
        ...(difficulty === null ? {} : { difficulty: parseDifficulty(difficulty) }),
        ...(generationTime !== null && generationTime !== topic.generationTime ? { lastGeneratedAt: null } : {}),
        enabled: true
      }
    });
    await reply(text("configured", { summary: topicSummary(updatedTopic, language) }));
    return;
  }

  const enabled = subcommand === "enable";
  await db.topic.update({ where: { id: topic.id }, data: { enabled } });
  await reply(text("configured", { summary: topicSummary({ ...topic, enabled }, language) }));
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
  return options.length >= 2 && options.length <= 4 && options.every(option => option.length <= 55) &&
    new Set(options.map(option => option.toLowerCase())).size === options.length ? options : null;
}

function topicSummary(topic: { name: string; enabled: boolean; intervalDays: number; questionsPerRun: number; generationTime: string | null; difficulty: string; options: string; optionCount: number }, language: string) {
  return message(language, "summary", { name: topic.name, state: message(language, topic.enabled ? "enabled" : "disabled"), days: topic.intervalDays,
    count: topic.questionsPerRun, time: topic.generationTime ?? message(language, "automatic"), difficulty: message(language, parseDifficulty(topic.difficulty)),
    answers: topic.options || message(language, "aiAnswers", { count: topic.optionCount }) });
}

function isOpenAIQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: number; code?: string };
  return apiError.status === 429 || apiError.code === "insufficient_quota" || apiError.code === "credit_balance_exhausted";
}
