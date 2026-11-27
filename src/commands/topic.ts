import { ChannelType, SlashCommandBuilder, type SlashCommandSubcommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { createTopic, MAX_TOPICS_PER_GUILD, TopicLimitError } from "../services/topic-creation.js";
import { publishCustomQuiz, publishRandomQuestion, publishTopicQuestions, QuizPublicationError, TopicChannelChangedError } from "../services/poll-publisher.js";
import { getHelpEmbed } from "./help.js";
import { AiGenerationError, AiQuestionNotAnswerableError } from "../services/question-generator.js";
import { env } from "../config.js";
import { guildTimezone } from "../services/timezone.js";
import { difficultyOption, parseDifficulty } from "../difficulty.js";
import { openFeedback } from "../feedback.js";
import { message, type MessageKey } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";
import { CUSTOM_MAX_DURATION_HOURS, DailyQuizLimitError, RandomQuizCooldownError, RANDOM_MAX_DURATION_HOURS, TopicScheduleNotReadyError, isGenerationTime, isScheduleDate, quizDay } from "../services/quiz-limits.js";
import { ensureGuildSettings, getGuildSettings } from "../services/guild-settings.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { scheduleEvents } from "../services/schedule-events.js";
import { inlineText } from "../formatting.js";
import { canUseRandomQuizChannel, RandomQuizChannelError, QuizChannelAccessError, resolveQuizChannel } from "../services/quiz-channels.js";
import { showTopicList } from "./topic-list.js";
import { QuizPingError, resolveQuizPingRole } from "../services/quiz-notifications.js";
import { maxQuestionLength } from "../types/question.js";

const maxCustomTopicLength = 80;

function topicOptions(subcommand: SlashCommandSubcommandBuilder, creating: boolean) {
  subcommand
    .addStringOption(option => option.setName("name").setDescription(creating ? "Name for a new topic; use edit for an existing topic." : "Existing topic to update; omitted settings remain unchanged.").setRequired(true).setMaxLength(80).setAutocomplete(!creating))
    .addChannelOption(option => option.setName("channel").setDescription(creating ? "Quiz destination; defaults to this channel." : "New quiz destination; omitted keeps the saved channel.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(option => option.setName("ping_role").setDescription(creating ? "Role to notify when this saved quiz starts; omitted means no ping." : "Role to notify when this saved quiz starts; omitted keeps the saved role."));
  if (!creating) subcommand.addBooleanOption(option => option.setName("clear_ping").setDescription("Remove the notification role; cannot be combined with ping_role."));
  return subcommand
    .addStringOption(option => option.setName("start_date").setDescription("First date YYYY-MM-DD; requires a publication time. Use none for rolling scheduling.").setMinLength(4).setMaxLength(10))
    .addStringOption(option => option.setName("generation_time").setDescription("Publication time HH:mm; none clears it only when no start_date is active.").setMinLength(4).setMaxLength(5))
    .addIntegerOption(option => option.setName("interval_days").setDescription("Repeat every 1-30 days; fixed schedules count from start_date.").setMinValue(1).setMaxValue(30))
    .addIntegerOption(option => option.setName("duration_hours").setDescription("Voting duration in hours (1-24), independent of the publication interval.").setMinValue(1).setMaxValue(24))
    .addStringOption(difficultyOption)
    .addIntegerOption(option => option.setName("option_count").setDescription(creating ? "Number of AI-created answers (2-4); default 4." : "Number of AI-created answers (2-4); replaces any legacy fixed answers.").setMinValue(2).setMaxValue(4));
}

function onDemandOptions(subcommand: SlashCommandSubcommandBuilder, maximumHours: number) {
  return subcommand
    .addIntegerOption(option => option.setName("option_count").setDescription("Number of generated answers (2-4); defaults to 4.").setMinValue(2).setMaxValue(4))
    .addStringOption(difficultyOption)
    .addIntegerOption(option => option.setName("duration_hours")
      .setDescription(`Voting duration in hours (1-${maximumHours}); default at most ${maximumHours} hours.`)
      .setMinValue(1).setMaxValue(maximumHours));
}

export const topicCommand = new SlashCommandBuilder()
  .setName("dilemma")
  .setDescription("Configure Dilemma quiz topics.")
  .addSubcommand((subcommand) => topicOptions(subcommand
    .setName("create")
    .setDescription("Create a new quiz topic with optional schedule and voting settings."), true))
  .addSubcommand((subcommand) => topicOptions(subcommand
    .setName("edit")
    .setDescription("Update an existing quiz topic; omitted settings remain unchanged."), false))
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
    .setDescription("Browse all saved quiz topics by start date and name, with filters."))
  .addSubcommand((subcommand) => subcommand
    .setName("help")
    .setDescription("Show Dilemma commands."))
  .addSubcommand(subcommand => onDemandOptions(subcommand
    .setName("random")
    .setDescription("Generate a random quiz: four per server day, at least six hours apart."), RANDOM_MAX_DURATION_HOURS))
  .addSubcommand(subcommand => onDemandOptions(subcommand
    .setName("custom")
    .setDescription("Publish a quiz from a topic or exact question. One per server day. Requires management access.")
    .addStringOption(option => option.setName("topic").setDescription("Topic for a generated question; use topic or question.").setMaxLength(maxCustomTopicLength))
    .addStringOption(option => option.setName("question").setDescription("Question to publish as written; use topic or question.").setMaxLength(maxQuestionLength)), CUSTOM_MAX_DURATION_HOURS))
  .addSubcommand((subcommand) => subcommand
    .setName("publish")
    .setDescription("Publish an available quiz slot early without shifting fixed repeat dates.")
    .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addIntegerOption((option) => option.setName("duration_hours").setDescription("Optional duration override for this quiz (1-24 hours).").setRequired(false).setMinValue(1).setMaxValue(24)));

export const topicSubcommands = new Set(topicCommand.toJSON().options?.map(sub => sub.name));

export async function handleTopic(interaction: ChatInputCommandInteraction) {
  const { language, settings: managementSettings, text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) {
    await reply(text("serverOnly"));
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help" || !topicSubcommands.has(subcommand)) {
    await reply({ content: null, embeds: [getHelpEmbed(language)] });
    return;
  }
  if (subcommand !== "random" && !canManageDilemma(interaction, managementSettings)) {
    await reply(text("permission"));
    return;
  }

  if (subcommand === "list") {
    await showTopicList(interaction, language, guildTimezone(managementSettings));
    return;
  }

  if (subcommand === "random" || subcommand === "custom") {
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await reply(text("channel"));
      return;
    }
    if (!await canUseRandomQuizChannel(interaction.guildId, channel.id)) { await reply(text("randomChannelOnly")); return; }
    if (interaction.options.getString("options") !== null) { await reply(text("randomCustomAnswersUnavailable")); return; }
    let customInput: Parameters<typeof publishCustomQuiz>[1] | undefined;
    if (subcommand === "custom") {
      const customTopic = interaction.options.getString("topic")?.trim();
      const requestedQuestion = interaction.options.getString("question")?.trim();
      if ((customTopic === undefined) === (requestedQuestion === undefined)) {
        await reply(text("customInputInvalid"));
        return;
      }
      if (requestedQuestion !== undefined) {
        if (!requestedQuestion || requestedQuestion.length > maxQuestionLength) { await reply(text("questionTextInvalid", { max: maxQuestionLength })); return; }
        customInput = { question: requestedQuestion };
      } else {
        if (!customTopic || customTopic.length > maxCustomTopicLength) { await reply(text("customTopicInvalid", { max: maxCustomTopicLength })); return; }
        customInput = { topic: customTopic };
      }
    }
    const requestedOptionCount = interaction.options.getInteger("option_count");
    const duration = interaction.options.getInteger("duration_hours");
    const maxDuration = subcommand === "custom" ? CUSTOM_MAX_DURATION_HOURS : RANDOM_MAX_DURATION_HOURS;
    const invalid = numberError(requestedOptionCount, 2, 4, "optionCountInvalid") ??
      numberError(duration, 1, maxDuration, subcommand === "custom" ? "durationInvalid" : "randomDurationInvalid");
    if (invalid) { await reply(text(invalid)); return; }
    const optionCount = requestedOptionCount ?? 4;
    const settings = await ensureGuildSettings(interaction.guildId);
    const difficulty = parseDifficulty(interaction.options.getString("difficulty") ?? settings.defaultDifficulty);
    const timeoutSeconds = Math.ceil(env.AI_GENERATION_TIMEOUT_MS / 1000);
    await reply(text("generating", { seconds: timeoutSeconds, difficulty: text(difficulty) }));
    try {
      const hours = duration ?? Math.min(settings.defaultPollDurationHours, maxDuration);
      const generatedTopic = customInput
        ? await publishCustomQuiz(interaction.guildId, customInput, optionCount, channel, difficulty, hours, interaction.user.id)
        : await publishRandomQuestion(interaction.guildId, optionCount, channel, difficulty, hours, interaction.user.id);
      await reply(customInput && "question" in customInput ? text("questionDone", { count: optionCount })
        : text("randomDone", { name: inlineText(generatedTopic), count: optionCount }));
    } catch (error) {
      if (error instanceof DailyQuizLimitError) {
        await reply(text(subcommand === "custom" ? "customDailyLimit" : "randomDailyLimit"));
        return;
      }
      if (error instanceof RandomQuizCooldownError) {
        const remainingMinutes = Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 60_000));
        await reply(text("randomCooldown",
          { hours: Math.floor(remainingMinutes / 60), minutes: remainingMinutes % 60 }));
        return;
      }
      const feedback = quizErrorFeedback(error);
      if (feedback) {
        await reply(text(feedback));
        return;
      }
      console.error("On-demand dilemma failed:", privateErrorSummary(error));
      await reply(text("generationFailed"));
    }
    return;
  }

  const name = interaction.options.getString("name", true).trim();
  if (!name || name.length > 80 || /[\r\n]/.test(name)) { await reply(text("nameInvalid")); return; }
  const settings = await ensureGuildSettings(interaction.guildId);

  if (subcommand === "create" || subcommand === "edit") {
    const creating = subcommand === "create";
    const existingTopic = await db.topic.findUnique({ where: { guildId_name: { guildId: interaction.guildId, name } } });
    if (creating && existingTopic) { await reply(text("topicExists", { name })); return; }
    if (!creating && !existingTopic) { await reply(text("missing", { name })); return; }
    const requestedDate = interaction.options.getString("start_date")?.trim() ?? null;
    const requestedTime = interaction.options.getString("generation_time")?.trim() ?? null;
    const startDate = requestedDate === "none" ? null : requestedDate;
    const generationTime = requestedTime === "none" ? null : requestedTime;
    const intervalDays = interaction.options.getInteger("interval_days");
    const pollDurationHours = interaction.options.getInteger("duration_hours");
    const optionCount = interaction.options.getInteger("option_count");
    const requestedDifficulty = interaction.options.getString("difficulty");
    const requestedChannel = interaction.options.getChannel("channel");
    const requestedPingRole = interaction.options.getRole("ping_role");
    const clearPing = !creating && interaction.options.getBoolean("clear_ping") === true;
    if (requestedPingRole && clearPing) { await reply(text("quizPingConflict")); return; }
    if (!creating && !clearPing && [requestedDate, requestedTime, intervalDays, pollDurationHours, optionCount, requestedDifficulty, requestedChannel, requestedPingRole].every(value => value === null)) {
      await reply(text("settingsMissing")); return;
    }
    const invalid = numberError(intervalDays, 1, 30, "intervalInvalid") ?? numberError(pollDurationHours, 1, 24, "durationInvalid") ?? numberError(optionCount, 2, 4, "optionCountInvalid");
    if (invalid) { await reply(text(invalid)); return; }
    if (startDate !== null && (!isScheduleDate(startDate) || startDate < quizDay(new Date(), guildTimezone(settings)))) {
      await reply(text("dateInvalid"));
      return;
    }
    if (generationTime !== null && !isGenerationTime(generationTime)) {
      await reply(text("timeInvalid"));
      return;
    }
    const effectiveDate = requestedDate === null ? existingTopic?.startDate ?? null : startDate;
    const effectiveTime = requestedTime === null ? (creating ? settings.defaultGenerationTime : existingTopic?.generationTime) ?? null : generationTime;
    if (effectiveDate && !effectiveTime) {
      await reply(text("scheduleTimeRequired"));
      return;
    }
    let channelId = existingTopic?.channelId ?? interaction.channelId;
    if (creating || requestedChannel) {
      if (requestedChannel && "guildId" in requestedChannel && requestedChannel.guildId !== interaction.guildId) {
        await reply(text("quizChannelInvalid")); return;
      }
      try { channelId = (await resolveQuizChannel(interaction.guild, requestedChannel?.id ?? interaction.channelId)).id; }
      catch (error) {
        if (!(error instanceof QuizChannelAccessError)) throw error;
        await reply(text(error.feedback)); return;
      }
    }
    let pingRoleId = clearPing ? null : existingTopic?.pingRoleId ?? null;
    if (requestedPingRole || (requestedChannel && pingRoleId)) {
      try { pingRoleId = await resolveQuizPingRole(interaction.guild, channelId!, requestedPingRole?.id ?? pingRoleId!); }
      catch (error) {
        if (!(error instanceof QuizPingError) && !(error instanceof QuizChannelAccessError)) throw error;
        await reply(text(error.feedback)); return;
      }
    }
    let topic;
    try {
      topic = creating ? await createTopic({
        guildId: interaction.guildId,
        name,
        language: settings.language,
        difficulty: parseDifficulty(requestedDifficulty ?? settings.defaultDifficulty),
        intervalDays: intervalDays ?? settings.defaultIntervalDays,
        generationTime: effectiveTime,
        startDate: effectiveDate,
        pollDurationHours: pollDurationHours ?? settings.defaultPollDurationHours,
        options: "",
        optionCount: optionCount ?? 4,
        channelId,
        pingRoleId
      }) : await db.topic.update({ where: { id: existingTopic!.id,
        startDate: existingTopic!.startDate ?? null, generationTime: existingTopic!.generationTime, channelId: existingTopic!.channelId }, data: {
        ...(requestedChannel === null ? {} : { channelId }),
        ...(requestedPingRole || clearPing ? { pingRoleId } : {}),
        ...(requestedDate === null ? {} : { startDate }),
        ...(requestedTime === null ? {} : { generationTime }),
        ...(intervalDays === null ? {} : { intervalDays }),
        ...(pollDurationHours === null ? {} : { pollDurationHours }),
        ...(optionCount === null ? {} : { optionCount, options: "" }),
        ...(requestedDifficulty === null ? {} : { difficulty: parseDifficulty(requestedDifficulty) }) }
      });
    } catch (error) {
      if (error instanceof TopicLimitError) {
        await reply(text("topicLimit", { limit: MAX_TOPICS_PER_GUILD })); return;
      }
      if (creating && error && typeof error === "object" && "code" in error && error.code === "P2002") {
        await reply(text("topicExists", { name })); return;
      }
      if (!creating && error && typeof error === "object" && "code" in error && error.code === "P2025") {
        await reply(text("topicChanged")); return;
      }
      throw error;
    }
    scheduleEvents.emit("topicChanged", { ...topic, timezone: guildTimezone(settings) });
    await reply(text(creating ? "topicCreated" : "configured", { summary: topicSummary(topic, language, guildTimezone(settings)) }));
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

  if (subcommand === "publish") {
    const duration = interaction.options.getInteger("duration_hours");
    const invalid = numberError(duration, 1, 24, "durationInvalid");
    if (invalid) { await reply(text(invalid)); return; }
    if (!topic.channelId) { await reply(text("topicChannelMissing")); return; }
    let channel;
    try { channel = await resolveQuizChannel(interaction.guild, topic.channelId); }
    catch (error) {
      if (!(error instanceof QuizChannelAccessError)) throw error;
      await reply(text(error.feedback)); return;
    }
    await reply(text("generating", { seconds: Math.ceil(env.AI_GENERATION_TIMEOUT_MS / 1000), difficulty: text(parseDifficulty(topic.difficulty)) }));
    try {
      await publishTopicQuestions({ ...topic,
        pollDurationHours: duration ?? topic.pollDurationHours }, channel);
    } catch (error) {
      if (error instanceof TopicScheduleNotReadyError) {
        await reply(text("topicScheduleUnavailable"));
        return;
      }
      if (error instanceof DailyQuizLimitError) {
        await reply(text("topicDailyLimit"));
        return;
      }
      const feedback = quizErrorFeedback(error);
      if (feedback) {
        await reply(text(feedback));
        return;
      }
      throw error;
    }
    await reply(text("runDone", { name: inlineText(topic.name), channel: `<#${channel.id}>` }));
    return;
  }

  const enabled = subcommand === "enable";
  const updatedTopic = await db.topic.update({ where: { id: topic.id }, data: { enabled } });
  scheduleEvents.emit("topicChanged", { ...updatedTopic, timezone: guildTimezone(settings) });
  await reply(text("configured", { summary: topicSummary({ ...topic, enabled }, language, guildTimezone(settings)) }));
}

export async function handleTopicAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== "name" || interaction.options.getSubcommand() === "create") {
    await interaction.respond([]);
    return;
  }
  if (!canManageDilemma(interaction, await getGuildSettings(interaction.guildId))) {
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

function numberError(value: number | null, min: number, max: number, key: MessageKey): MessageKey | null {
  return value !== null && (!Number.isInteger(value) || value < min || value > max) ? key : null;
}

function topicSummary(topic: { name: string; enabled: boolean; intervalDays: number; pollDurationHours: number; generationTime: string | null; startDate?: string | null; channelId?: string | null; pingRoleId?: string | null; difficulty: string; options: string; optionCount: number }, language: string, timezone: string) {
  return message(language, "summary", { name: inlineText(topic.name), state: message(language, topic.enabled ? "enabled" : "disabled"), days: topic.intervalDays,
    start: topic.startDate ?? message(language, "scheduleUnset"),
    channel: topic.channelId ? `<#${topic.channelId}>` : message(language, "scheduleUnset"),
    hours: topic.pollDurationHours, time: topic.generationTime ? `${topic.generationTime} (${timezone})` : message(language, "manualPublication"), difficulty: message(language, parseDifficulty(topic.difficulty)),
    answers: topic.options ? inlineText(topic.options) : message(language, "aiAnswers", { count: topic.optionCount }) }) +
    `\n- ${message(language, "quizPingSummary", { role: topic.pingRoleId ? `<@&${topic.pingRoleId}>` : message(language, "disabled") })}`;
}

function quizErrorFeedback(error: unknown): MessageKey | null {
  if (error instanceof TopicChannelChangedError) return "topicChanged";
  if (error instanceof RandomQuizChannelError) return "randomChannelOnly";
  if (error instanceof AiQuestionNotAnswerableError) return "questionUnanswerable";
  if (error instanceof AiGenerationError) {
    return { unavailable: "aiUnavailable", limit: "quota", configuration: "aiConfiguration", "invalid-response": "aiInvalidResponse", timeout: "timeout" }[error.kind] as MessageKey;
  }
  if (error instanceof QuizPublicationError) return error.permissionDenied ? "publishPermission" : "generationFailed";
  return null;
}
