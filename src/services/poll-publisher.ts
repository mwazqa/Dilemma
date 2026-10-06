import type { SendableChannels } from "discord.js";
import type { Topic } from "@prisma/client";
import { db } from "../db.js";
import { generateQuestion } from "./question-generator.js";
import { getVotePrompt } from "../brand.js";
import { env } from "../config.js";
import { defaultDifficulty, parseDifficulty, type Difficulty } from "../difficulty.js";
import { message } from "../messages.js";

export async function publishTopicQuestions(topic: Topic, channel: SendableChannels): Promise<number> {
  const options = topic.options.split(",").map((option) => option.trim()).filter(Boolean);
  const previousQuestions = (await db.generatedPoll.findMany({
    where: { topicId: topic.id },
    select: { question: true },
    orderBy: { createdAt: "desc" },
    take: 100
  })).map((poll) => poll.question);
  for (let index = 0; index < topic.questionsPerRun; index += 1) {
    const difficulty = parseDifficulty(topic.difficulty);
    const question = await generateUniqueQuestion(topic.name, topic.language, options, topic.optionCount, previousQuestions, difficulty);
    previousQuestions.push(question.question);
    const questionNumber = topic.questionsGenerated + index + 1;
    const sentPoll = await channel.send({
      content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${topic.name} · #${questionNumber}**\n${message(topic.language, "difficulty", { difficulty: message(topic.language, difficulty) })}\n\n${getVotePrompt(topic.language)}`,
      allowedMentions: { parse: [] },
      poll: {
        question: { text: question.question },
        answers: question.options.map((option, optionIndex) => {
          const emoji = question.optionEmojis[optionIndex] ?? "";
          return emoji ? { text: option, emoji } : { text: option };
        }),
        duration: 24,
        allowMultiselect: false
      }
    });
    await db.topic.update({
      where: { id: topic.id },
      data: { questionsGenerated: { increment: 1 } }
    });
    await db.generatedPoll.create({
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
  }
  await db.topic.update({ where: { id: topic.id }, data: { channelId: channel.id, lastGeneratedAt: new Date() } });
  return topic.questionsPerRun;
}

export async function publishRandomQuestion(
  guildId: string,
  language: string,
  optionCount: number,
  channel: SendableChannels,
  difficulty: Difficulty = defaultDifficulty
): Promise<string> {
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
  const sentPoll = await channel.send({
    content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${question.topic}**\n${message(language, "difficulty", { difficulty: message(language, difficulty) })}\n\n${getVotePrompt(language)}`,
    allowedMentions: { parse: [] },
    poll: {
      question: { text: question.question },
      answers: question.options.map((option, optionIndex) => {
        const emoji = question.optionEmojis[optionIndex] ?? "";
        return emoji ? { text: option, emoji } : { text: option };
      }),
      duration: 24,
      allowMultiselect: false
    }
  });
  await db.randomPoll.create({
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
  return question.topic;
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
