import { PermissionFlagsBits, type SendableChannels } from "discord.js";
import type { Topic } from "@prisma/client";
import { db } from "../db.js";
import { AiGenerationError, generateQuestion, repeatsQuestionFact } from "./question-generator.js";
import { env } from "../config.js";
import { defaultDifficulty, parseDifficulty, type Difficulty } from "../difficulty.js";
import { message, normalizeLanguage } from "../messages.js";
import { getVotePrompt } from "../brand.js";
import { buttonSettlementData, quizVotingPayload } from "./quiz-voting.js";
import { normalizeRandomCategory } from "./random-categories.js";
import { claimQuizRun, quizDay, RANDOM_MAX_DURATION_HOURS, refreshRandomQuizRun, releaseQuizRun, runKey, validatePollDuration } from "./quiz-limits.js";
import { scheduleEvents } from "./schedule-events.js";
import { getGuildSettings } from "./guild-settings.js";
import { guildTimezone } from "./timezone.js";
import { requireQuizChannel } from "./quiz-channels.js";
import { resolveQuizPingRole } from "./quiz-notifications.js";
import { loadQuestionFacts, loadQuestionHistory } from "./question-history.js";
import { QuestionNoveltyIndex, withQuestionPublication, type PastQuestion } from "./question-novelty.js";

export class QuizPublicationError extends Error {
  readonly permissionDenied: boolean;
  constructor(error: unknown) {
    super("Quiz publication could not be confirmed");
    this.name = "QuizPublicationError";
    this.permissionDenied = !!error && typeof error === "object" && "code" in error && (error.code === 50013 || error.code === 50001);
  }
}

export async function publishTopicQuestions(topic: Topic, channel: SendableChannels, early = true): Promise<number> {
  return withQuestionPublication(topic.guildId, () => publishTopicQuestion(topic, channel, early));
}

async function publishTopicQuestion(topic: Topic, channel: SendableChannels, early: boolean): Promise<number> {
  const duration = validatePollDuration(topic.pollDurationHours);
  if (!topic.channelId || topic.channelId !== channel.id) throw new TopicChannelChangedError();
  const settings = await getGuildSettings(topic.guildId);
  let timezone = guildTimezone(settings);
  let run = await claimQuizRun(topic.guildId, topic.id, new Date(), early, timezone);
  let sendAttempted = false;
  try {
    const language = normalizeLanguage(settings?.language ?? "en");
    const options = topic.options.split(",").map((option) => option.trim()).filter(Boolean);
    const history = await loadQuestionHistory(topic.guildId, topic);
    const difficulty = parseDifficulty(topic.difficulty);
    const question = await generateUniqueQuestion(topic.guildId, topic.name, language, options, topic.optionCount, history.questions, difficulty, [], topic.id);
    const currentTimezone = guildTimezone(await getGuildSettings(topic.guildId));
    if (run.day !== quizDay(new Date(), currentTimezone) || timezone !== currentTimezone) {
      await releaseQuizRun(run);
      timezone = currentTimezone;
      run = await claimQuizRun(topic.guildId, topic.id, new Date(), early, timezone);
    }
    const latestTopic = await db.topic.findUnique({ where: { id: topic.id }, select: { channelId: true, guildId: true, pingRoleId: true } });
    if (!latestTopic || latestTopic.guildId !== topic.guildId || latestTopic.channelId !== channel.id) throw new TopicChannelChangedError();
    let pingRoleId: string | null = null;
    if (latestTopic.pingRoleId && "guild" in channel && channel.guild.id === topic.guildId) {
      try { pingRoleId = await resolveQuizPingRole(channel.guild, channel.id, latestTopic.pingRoleId); }
      catch { console.warn("Quiz notification skipped: role-or-permission-unavailable"); }
    }
    if (pingRoleId) {
      const beforeSend = await db.topic.findUnique({ where: { id: topic.id }, select: { channelId: true, guildId: true, pingRoleId: true } });
      if (!beforeSend || beforeSend.guildId !== topic.guildId || beforeSend.channelId !== channel.id) throw new TopicChannelChangedError();
      if (beforeSend.pingRoleId !== pingRoleId) pingRoleId = null;
    }
    const questionNumber = topic.questionsGenerated + 1;
    const expiresAt = new Date(Date.now() + duration * 3_600_000);
    sendAttempted = true;
    const sentPoll = await channel.send({
      content: `${pingRoleId ? `<@&${pingRoleId}>\n` : ""}**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${topic.name} · #${questionNumber}**\n${message(language, "difficulty", { difficulty: message(language, difficulty) })}\n\n${getVotePrompt(language)}`,
      allowedMentions: { parse: [], roles: pingRoleId ? [pingRoleId] : [], users: [], repliedUser: false },
      ...await quizVotingPayload(question, expiresAt, language, canAttachQuizCard(channel))
    }).catch(error => { throw new QuizPublicationError(error); });
    const settlement = buttonSettlementData({ messageId: sentPoll.id, guildId: topic.guildId, channelId: channel.id }, difficulty, question.options.length, question.correctOption, expiresAt);
    const updatedTopic = await db.$transaction(async tx => {
      const updated = await tx.topic.update({
        where: { id: topic.id },
        data: { questionsGenerated: { increment: 1 }, lastGeneratedAt: new Date() }
      });
      await tx.generatedPoll.create({
        data: {
          guildId: topic.guildId,
          difficulty,
          topicId: topic.id,
          messageId: sentPoll.id,
          channelId: channel.id,
          question: question.question,
          options: JSON.stringify(question.options),
          correctOption: question.correctOption,
          explanation: question.explanation,
          topicEmoji: question.topicEmoji,
          optionEmojis: question.optionEmojis.join("||")
        }
      });
      await tx.quizSettlement.create({ data: settlement });
      await tx.dailyQuizRun.update({ where: runKey(run), data: { messageId: sentPoll.id } });
      if (run.cycleRun) await tx.dailyQuizRun.update({ where: runKey(run.cycleRun), data: { messageId: sentPoll.id } });
      return updated;
    });
    scheduleEvents.emit("topicChanged", { ...updatedTopic, timezone: guildTimezone(await getGuildSettings(topic.guildId)) });
    scheduleEvents.emit("settlementChanged", { ...settlement, closedAt: null, scoredAt: null, nextCheckAt: new Date() });
    return 1;
  } finally {
    if (!sendAttempted) await releaseQuizRun(run);
  }
}

export class TopicChannelChangedError extends Error {
  constructor() { super("Topic destination changed"); this.name = "TopicChannelChangedError"; }
}

export async function publishRandomQuestion(
  guildId: string,
  optionCount: number,
  channel: SendableChannels,
  difficulty: Difficulty = defaultDifficulty,
  durationHours = RANDOM_MAX_DURATION_HOURS,
  options: string[] = [],
  creatorUserId: string | null = null
): Promise<string> {
  return withQuestionPublication(guildId, () => publishRandom(guildId, optionCount, channel, difficulty, durationHours, options, creatorUserId));
}

async function publishRandom(guildId: string, optionCount: number, channel: SendableChannels, difficulty: Difficulty,
  durationHours: number, options: string[], creatorUserId: string | null): Promise<string> {
  const duration = validatePollDuration(durationHours, RANDOM_MAX_DURATION_HOURS);
  await requireQuizChannel(guildId, channel.id);
  const settings = await getGuildSettings(guildId);
  let run = await claimQuizRun(guildId, undefined, new Date(), true, guildTimezone(settings));
  let sendAttempted = false;
  try {
    const language = normalizeLanguage(settings?.language ?? "en");
    const history = await loadQuestionHistory(guildId);
    const recentCategories = options.length ? [] : history.categories;
    const question = await generateUniqueQuestion(
      guildId,
      "a freely chosen, random, surprising and family-friendly general-knowledge topic" + (options.length ? " suited to the supplied answers" : ""),
      language,
      options,
      optionCount,
      history.questions,
      difficulty,
      recentCategories
    );
    run = await refreshRandomQuizRun(run, guildTimezone(await getGuildSettings(guildId)));
    await requireQuizChannel(guildId, channel.id);
    const expiresAt = new Date(Date.now() + duration * 3_600_000);
    sendAttempted = true;
    const sentPoll = await channel.send({
      content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${question.topic}**\n${message(language, "difficulty", { difficulty: message(language, difficulty) })}\n\n${getVotePrompt(language)}`,
      allowedMentions: { parse: [] },
      ...await quizVotingPayload(question, expiresAt, language, canAttachQuizCard(channel))
    }).catch(error => { throw new QuizPublicationError(error); });
    const settlement = buttonSettlementData({ messageId: sentPoll.id, guildId, channelId: channel.id }, difficulty, question.options.length, question.correctOption, expiresAt);
    await db.$transaction(async tx => {
      await tx.randomPoll.create({
        data: {
          guildId,
          creatorUserId,
          difficulty,
          language,
          category: options.length ? null : question.topic,
          messageId: sentPoll.id,
          channelId: channel.id,
          question: question.question,
          options: JSON.stringify(question.options),
          correctOption: question.correctOption,
          explanation: question.explanation,
          optionEmojis: question.optionEmojis.join("||")
        }
      });
      await tx.quizSettlement.create({ data: settlement });
      const createdAt = new Date();
      for (const reservation of [run, run.dailyRun!]) {
        const saved = await tx.dailyQuizRun.updateMany({ where: { ...runKey(reservation).guildId_scope_day_slot,
          createdAt: reservation.createdAt, messageId: null }, data: { messageId: sentPoll.id, createdAt } });
        if (!saved.count) throw new Error("Random quiz reservation changed before persistence");
      }
    });
    scheduleEvents.emit("randomPollPublished", guildId);
    scheduleEvents.emit("settlementChanged", { ...settlement, closedAt: null, scoredAt: null, nextCheckAt: new Date() });
    return question.topic;
  } finally {
    if (!sendAttempted) await releaseQuizRun(run);
  }
}

async function generateUniqueQuestion(
  guildId: string,
  topic: string,
  language: string,
  allowedOptions: string[],
  optionCount: number,
  history: PastQuestion[],
  difficulty: Difficulty = defaultDifficulty,
  avoidTopics: string[] = [],
  topicId?: string
) {
  const index = new QuestionNoveltyIndex(history);
  const recentCategories = new Set(avoidTopics.map(normalizeRandomCategory));
  const rejected: string[] = [];
  const signal = AbortSignal.timeout(env.AI_GENERATION_TIMEOUT_MS);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const question = await generateQuestion(topic, language, allowedOptions, optionCount, index.prompt(topicId, rejected), signal, difficulty, avoidTopics);
    if (!index.hasExact(question.question) && !recentCategories.has(normalizeRandomCategory(question.topic))) {
      const candidates = index.candidates(question.question, question.options[question.correctOption]);
      if (!candidates.length || !await repeatsQuestionFact(question, await loadQuestionFacts(guildId, candidates), signal)) return question;
      rejected.unshift(...candidates.map(row => row.question));
    }
    index.reject(question.question);
    rejected.unshift(question.question);
  }
  throw new AiGenerationError("invalid-response");
}

function canAttachQuizCard(channel: SendableChannels): boolean {
  if (!("guild" in channel)) return true;
  const member = channel.guild.members?.me;
  return Boolean(member && channel.permissionsFor(member)?.has(PermissionFlagsBits.AttachFiles));
}
