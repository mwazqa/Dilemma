import type { SendableChannels } from "discord.js";
import type { Topic } from "@prisma/client";
import { db } from "../db.js";
import { generateQuestion } from "./question-generator.js";
import { getVotePrompt } from "../brand.js";
import { env } from "../config.js";
import { defaultDifficulty, parseDifficulty, type Difficulty } from "../difficulty.js";
import { message, normalizeLanguage } from "../messages.js";
import { settlementData } from "./scoring.js";
import { claimQuizRun, quizDay, releaseQuizRun, runKey, validatePollDuration } from "./quiz-limits.js";
import { pollControls } from "./poll-controls.js";

export async function publishTopicQuestions(topic: Topic, channel: SendableChannels): Promise<number> {
  const duration = validatePollDuration(topic.pollDurationHours);
  let run = await claimQuizRun(topic.guildId, topic.id);
  let sendAttempted = false;
  try {
    const settings = await db.guildSettings.findUnique({ where: { guildId: topic.guildId } });
    const language = normalizeLanguage(settings?.language ?? "en");
    const options = topic.options.split(",").map((option) => option.trim()).filter(Boolean);
    const previousQuestions = (await db.generatedPoll.findMany({
      where: { topicId: topic.id },
      select: { question: true },
      orderBy: { createdAt: "desc" },
      take: 100
    })).map((poll) => poll.question);
    const difficulty = parseDifficulty(topic.difficulty);
    const question = await generateUniqueQuestion(topic.name, language, options, topic.optionCount, previousQuestions, difficulty);
    previousQuestions.push(question.question);
    if (run.day !== quizDay(new Date())) {
      await releaseQuizRun(run);
      run = await claimQuizRun(topic.guildId, topic.id);
    }
    const questionNumber = topic.questionsGenerated + 1;
    sendAttempted = true;
    const sentPoll = await channel.send({
      content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${topic.name} · #${questionNumber}**\n${message(language, "difficulty", { difficulty: message(language, difficulty) })}\n\n${getVotePrompt(language)}`,
      allowedMentions: { parse: [] },
      components: pollControls(language),
      poll: {
        question: { text: question.question },
        answers: question.options.map((option, optionIndex) => {
          const emoji = question.optionEmojis[optionIndex] ?? "";
          return emoji ? { text: option, emoji } : { text: option };
        }),
        duration,
        allowMultiselect: false
      }
    });
    const settlement = settlementData(sentPoll, topic.guildId, difficulty, question.options, question.correctOption);
    await db.$transaction(async tx => {
      await tx.topic.update({
        where: { id: topic.id },
        data: { questionsGenerated: { increment: 1 }, channelId: channel.id, lastGeneratedAt: new Date() }
      });
      await tx.generatedPoll.create({
        data: {
          guildId: topic.guildId,
          difficulty,
          topicId: topic.id,
          messageId: sentPoll.id,
          channelId: channel.id,
          question: question.question,
          options: question.options.join("||"),
          correctOption: question.correctOption,
          explanation: question.explanation,
          topicEmoji: question.topicEmoji,
          optionEmojis: question.optionEmojis.join("||")
        }
      });
      await tx.quizSettlement.create({ data: settlement });
      await tx.dailyQuizRun.update({ where: runKey(run), data: { messageId: sentPoll.id } });
    });
    return 1;
  } finally {
    // Keep the reservation after a send attempt: a transport failure may still have published the poll.
    if (!sendAttempted) await releaseQuizRun(run);
  }
}

export async function publishRandomQuestion(
  guildId: string,
  language: string,
  optionCount: number,
  channel: SendableChannels,
  difficulty: Difficulty = defaultDifficulty,
  durationHours = 24
): Promise<string> {
  const duration = validatePollDuration(durationHours);
  let run = await claimQuizRun(guildId);
  let sendAttempted = false;
  try {
    const previousQuestions = (await db.randomPoll.findMany({
      where: { guildId },
      select: { question: true },
      orderBy: { createdAt: "desc" },
      take: 100
    })).map((poll) => poll.question);
    const question = await generateUniqueQuestion(
      "a random, surprising and family-friendly general-knowledge topic",
      language,
      [],
      optionCount,
      previousQuestions,
      difficulty
    );
    if (run.day !== quizDay(new Date())) {
      await releaseQuizRun(run);
      run = await claimQuizRun(guildId);
    }
    sendAttempted = true;
    const sentPoll = await channel.send({
      content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${question.topic}**\n${message(language, "difficulty", { difficulty: message(language, difficulty) })}\n\n${getVotePrompt(language)}`,
      allowedMentions: { parse: [] },
      components: pollControls(language),
      poll: {
        question: { text: question.question },
        answers: question.options.map((option, optionIndex) => {
          const emoji = question.optionEmojis[optionIndex] ?? "";
          return emoji ? { text: option, emoji } : { text: option };
        }),
        duration,
        allowMultiselect: false
      }
    });
    const settlement = settlementData(sentPoll, guildId, difficulty, question.options, question.correctOption);
    await db.$transaction(async tx => {
      await tx.randomPoll.create({
        data: {
          guildId,
          difficulty,
          language,
          messageId: sentPoll.id,
          channelId: channel.id,
          question: question.question,
          options: question.options.join("||"),
          correctOption: question.correctOption,
          explanation: question.explanation,
          optionEmojis: question.optionEmojis.join("||")
        }
      });
      await tx.quizSettlement.create({ data: settlement });
      await tx.dailyQuizRun.update({ where: runKey(run), data: { messageId: sentPoll.id } });
    });
    return question.topic;
  } finally {
    if (!sendAttempted) await releaseQuizRun(run);
  }
}

async function generateUniqueQuestion(
  topic: string,
  language: string,
  allowedOptions: string[],
  optionCount: number,
  previousQuestions: string[],
  difficulty: Difficulty = defaultDifficulty
) {
  const normalizedPrevious = new Set(previousQuestions.map(normalizeQuestionText));
  const signal = AbortSignal.timeout(env.AI_GENERATION_TIMEOUT_MS);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const question = await generateQuestion(topic, language, allowedOptions, optionCount, previousQuestions.slice(-20), signal, difficulty);
    if (!normalizedPrevious.has(normalizeQuestionText(question.question))) return question;
    previousQuestions.push(question.question);
  }
  throw new Error("AI generated a duplicate question three times");
}

function normalizeQuestionText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
