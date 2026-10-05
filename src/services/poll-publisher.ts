import type { SendableChannels } from "discord.js";
import type { Topic } from "@prisma/client";
import { db } from "../db.js";
import { generateQuestion } from "./question-generator.js";
import { getVotePrompt } from "../brand.js";

export async function publishTopicQuestions(topic: Topic, channel: SendableChannels): Promise<number> {
  const options = topic.options.split(",").map((option) => option.trim()).filter(Boolean);
  for (let index = 0; index < topic.questionsPerRun; index += 1) {
    const question = await generateQuestion(topic.name, topic.language, options, topic.optionCount);
    const countedTopic = await db.topic.update({
      where: { id: topic.id },
      data: { questionsGenerated: { increment: 1 } }
    });
    const sentPoll = await channel.send({
      content: `**${question.topicEmoji ? `${question.topicEmoji} ` : ""}${topic.name} · #${countedTopic.questionsGenerated}**\n\n${getVotePrompt(topic.language)}`,
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
    await db.generatedPoll.create({
      data: {
        guildId: topic.guildId,
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
