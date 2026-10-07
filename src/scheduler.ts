import type { Client } from "discord.js";
import { db } from "./db.js";
import { publishTopicQuestions } from "./services/poll-publisher.js";
import { privateErrorSummary } from "./private-errors.js";
import { DailyQuizLimitError, isTopicDue } from "./services/quiz-limits.js";

const schedulerIntervalMs = 60_000;

export function startScheduler(client: Client) {
  void runDueTopics(client);
  const now = new Date();
  const millisecondsToNextMinute = schedulerIntervalMs - (now.getSeconds() * 1_000 + now.getMilliseconds());
  return setTimeout(() => {
    void runDueTopics(client);
    setInterval(() => void runDueTopics(client), schedulerIntervalMs);
  }, millisecondsToNextMinute);
}

let running = false;
export async function runDueTopics(client: Client) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const topics = await db.topic.findMany({
      where: { enabled: true, generationTime: { not: null }, channelId: { not: null } }
    });

    for (const topic of topics) {
      if (!isTopicDue(topic, now)) continue;

      try {
        const channel = await client.channels.fetch(topic.channelId!);
        if (!channel?.isSendable()) continue;
        await publishTopicQuestions(topic, channel);
        console.log("Scheduled generation completed");
      } catch (error) {
        if (error instanceof DailyQuizLimitError) continue;
        console.error("Scheduled generation failed:", privateErrorSummary(error));
      }
    }
  } finally { running = false; }
}
