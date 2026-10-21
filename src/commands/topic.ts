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
import { DailyQuizLimitError, RandomQuizCooldownError, TopicScheduleNotReadyError, isGenerationTime, isScheduleDate, quizDay } from "../services/quiz-limits.js";
import { ensureGuildSettings } from "../services/guild-settings.js";
import { scheduleEvents } from "../services/schedule-events.js";

export const topicCommand = new SlashCommandBuilder()
  .setName("dilemma")
  .setDescription("Configure Dilemma quiz topics.")
  .addSubcommand((subcommand) => subcommand
    .setName("create")
    .setDescription("Create or update a quiz topic, optionally with a dated repeating schedule.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((option) => option.setName("start_date").setDescription("First publication date YYYY-MM-DD in the bot quiz timezone.").setRequired(false).setMinLength(10).setMaxLength(10))
    .addStringOption((option) => option.setName("generation_time").setDescription("Publication time HH:mm in the bot quiz timezone.").setRequired(false).setMinLength(5).setMaxLength(5))
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Repeat every this many calendar days from the start date.").setRequired(false).setMinValue(1).setMaxValue(30))
    .addStringOption((option) => option.setName("options").setDescription("Optional: answers separated by commas. If empty, AI creates them.").setRequired(false).setMaxLength(500))
    .addIntegerOption((option) => option.setName("option_count").setDescription("Required only when options is empty: number of AI-created answers.").setRequired(false).setMinValue(2).setMaxValue(4))
    .addStringOption(difficultyOption))
  .addSubcommand((subcommand) => subcommand
    .setName("configure")
    .setDescription("Override generation settings for one topic.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((option) => option.setName("start_date").setDescription("First date YYYY-MM-DD; none removes the fixed-date schedule.").setRequired(false).setMaxLength(10))
    .addIntegerOption((option) => option.setName("interval_days").setDescription("Optional: days between AI generations.").setRequired(false).setMinValue(1).setMaxValue(30))
    .addIntegerOption((option) => option.setName("duration_hours").setDescription("Poll duration in hours (1-24).").setRequired(false).setMinValue(1).setMaxValue(24))
    .addStringOption((option) => option.setName("generation_time").setDescription("Optional HH:mm in the bot quiz timezone for automatic generation.").setRequired(false).setMaxLength(5))
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
    .setName("list")
    .setDescription("List quiz topics for this server."))
  .addSubcommand((subcommand) => subcommand
    .setName("help")
    .setDescription("Show Dilemma commands."))
  .addSubcommand((subcommand) => subcommand
    .setName("random")
    .setDescription("Generate a random quiz: two per server day, at least eight hours apart.")
    .addIntegerOption((option) => option
      .setName("option_count")
      .setDescription("Number of AI-generated answers.")
      .setRequired(true)
      .setMinValue(2)
      .setMaxValue(4))
    .addStringOption(difficultyOption)
    .addIntegerOption((option) => option.setName("duration_hours").setDescription("Poll duration in hours (1-24).").setRequired(false).setMinValue(1).setMaxValue(24)))
  .addSubcommand((subcommand) => subcommand
    .setName("run")
    .setDescription("Publish an available quiz slot early without shifting fixed repeat dates.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addIntegerOption((option) => option.setName("duration_hours").setDescription("Optional duration override for this poll (1-24 hours).").setRequired(false).setMinValue(1).setMaxValue(24)));

const topicSubcommands = new Set(topicCommand.toJSON().options?.map(sub => sub.name));

export async function handleTopic(interaction: ChatInputCommandInteraction) {
  const { language, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help" || !topicSubcommands.has(subcommand)) {
    await reply({ content: null, embeds: [getHelpEmbed(language)] });
    return;
  }
  if (subcommand !== "random" && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
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
    const settings = await ensureGuildSettings(interaction.guildId);
    const optionCount = interaction.options.getInteger("option_count", true);
    const difficulty = parseDifficulty(interaction.options.getString("difficulty") ?? settings.defaultDifficulty);
    const timeoutSeconds = Math.ceil(env.AI_GENERATION_TIMEOUT_MS / 1000);
    await reply(text("generating", { seconds: timeoutSeconds, difficulty: text(difficulty) }));
    try {
      const generatedTopic = await publishRandomQuestion(interaction.guildId, optionCount, channel, difficulty,
        interaction.options.getInteger("duration_hours") ?? settings.defaultPollDurationHours);
      await reply(text("randomDone", { name: generatedTopic, count: optionCount }));
    } catch (error) {
      if (error instanceof DailyQuizLimitError) {
        await reply(text("randomDailyLimit"));
        return;
      }
      if (error instanceof RandomQuizCooldownError) {
        await reply(text("randomCooldown", { minutes: Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 60_000)) }));
        return;
      }
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

  const name = interaction.options.getString("name", true).trim();
  const settings = await ensureGuildSettings(interaction.guildId);

  if (subcommand === "create") {
    const startDate = interaction.options.getString("start_date")?.trim() ?? null;
    const generationTime = interaction.options.getString("generation_time")?.trim() ?? null;
    const intervalDays = interaction.options.getInteger("interval_days");
    if (startDate !== null && (!isScheduleDate(startDate) || startDate < quizDay(new Date()))) {
      await reply(text("dateInvalid"));
      return;
    }
    if (generationTime !== null && !isGenerationTime(generationTime)) {
      await reply(text("timeInvalid"));
      return;
    }
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
    const existingTopic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name } } });
    if ((startDate ?? existingTopic?.startDate) && !(generationTime ?? existingTopic?.generationTime ?? settings.defaultGenerationTime)) {
      await reply(text("scheduleTimeRequired"));
      return;
    }
    const topic = await db.topic.upsert({
      where: { guildId_name: { guildId: interaction.guildId, name } },
      create: {
        guildId: interaction.guildId,
        name,
        language: settings.language,
        difficulty: parseDifficulty(requestedDifficulty ?? settings.defaultDifficulty),
        intervalDays: intervalDays ?? settings.defaultIntervalDays,
        generationTime: generationTime ?? settings.defaultGenerationTime ?? null,
        startDate,
        pollDurationHours: settings.defaultPollDurationHours,
        options: options?.join(", ") ?? "",
        optionCount,
        channelId: interaction.channelId
      },
      update: { language: settings.language, options: options?.join(", ") ?? "", optionCount, channelId: interaction.channelId, enabled: true,
        ...(startDate === null ? {} : { startDate }),
        ...(generationTime === null ? {} : { generationTime }),
        ...(intervalDays === null ? {} : { intervalDays }),
        ...(requestedDifficulty === null ? {} : { difficulty: parseDifficulty(requestedDifficulty) }) }
    });
    scheduleEvents.emit("topicChanged", topic);
    await reply(topic.startDate ? text("configured", { summary: topicSummary(topic, language) })
      : text("saved", { name: topic.name, count: optionCount, difficulty: text(parseDifficulty(topic.difficulty)) }));
    return;
  }

  const topic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name } } });
  if (!topic) {
    await reply(text("missing", { name }));
    return;
  }

  if (subcommand === "delete") {
    await db.topic.delete({ where: { id: topic.id } });
    scheduleEvents.emit("topicDeleted", topic.id);
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
      await publishTopicQuestions({ ...topic,
        pollDurationHours: interaction.options.getInteger("duration_hours") ?? topic.pollDurationHours }, channel);
    } catch (error) {
      if (error instanceof TopicScheduleNotReadyError) {
        await reply(text("topicScheduleUnavailable"));
        return;
      }
      if (error instanceof DailyQuizLimitError) {
        await reply(text("topicDailyLimit"));
        return;
      }
      if (error instanceof AiGenerationTimeoutError) {
        await reply(text("timeout"));
        return;
      }
      if (isOpenAIQuotaError(error)) {
        await reply(text("quota"));
        return;
      }
      throw error;
    }
    await reply(text("runDone", { name: topic.name }));
    return;
  }

  if (subcommand === "configure") {
    const intervalDays = interaction.options.getInteger("interval_days");
    const pollDurationHours = interaction.options.getInteger("duration_hours");
    const generationTime = interaction.options.getString("generation_time")?.trim() || null;
    const requestedDate = interaction.options.getString("start_date")?.trim() ?? null;
    const startDate = requestedDate === "none" ? null : requestedDate;
    const difficulty = interaction.options.getString("difficulty");
    if (intervalDays === null && pollDurationHours === null && generationTime === null && difficulty === null && requestedDate === null) {
      await reply(text("settingsMissing"));
      return;
    }
    if (generationTime && !isGenerationTime(generationTime)) {
      await reply(text("timeInvalid"));
      return;
    }
    if (startDate !== null && (!isScheduleDate(startDate) || startDate < quizDay(new Date()))) {
      await reply(text("dateInvalid"));
      return;
    }
    if ((requestedDate === null ? topic.startDate : startDate) && !(generationTime ?? topic.generationTime)) {
      await reply(text("scheduleTimeRequired"));
      return;
    }
    const updatedTopic = await db.topic.update({
      where: { id: topic.id },
      data: {
        ...(intervalDays === null ? {} : { intervalDays }),
        ...(pollDurationHours === null ? {} : { pollDurationHours }),
        ...(generationTime === null ? {} : { generationTime }),
        ...(requestedDate === null ? {} : { startDate }),
        ...(difficulty === null ? {} : { difficulty: parseDifficulty(difficulty) }),
        enabled: true
      }
    });
    scheduleEvents.emit("topicChanged", updatedTopic);
    await reply(text("configured", { summary: topicSummary(updatedTopic, language) }));
    return;
  }

  const enabled = subcommand === "enable";
  const updatedTopic = await db.topic.update({ where: { id: topic.id }, data: { enabled } });
  scheduleEvents.emit("topicChanged", updatedTopic);
  await reply(text("configured", { summary: topicSummary({ ...topic, enabled }, language) }));
}

export async function handleTopicAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== "name") {
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

function topicSummary(topic: { name: string; enabled: boolean; intervalDays: number; pollDurationHours: number; generationTime: string | null; startDate?: string | null; difficulty: string; options: string; optionCount: number }, language: string) {
  const summary = message(language, "summary", { name: topic.name, state: message(language, topic.enabled ? "enabled" : "disabled"), days: topic.intervalDays,
    hours: topic.pollDurationHours, time: topic.generationTime ? `${topic.generationTime} (${env.QUIZ_TIMEZONE})` : message(language, "automatic"), difficulty: message(language, parseDifficulty(topic.difficulty)),
    answers: topic.options || message(language, "aiAnswers", { count: topic.optionCount }) });
  return topic.startDate ? `${summary}; ${message(language, "scheduleStart", { date: topic.startDate })}` : summary;
}

function isOpenAIQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: number; code?: string };
  return apiError.status === 429 || apiError.code === "insufficient_quota" || apiError.code === "credit_balance_exhausted";
}
