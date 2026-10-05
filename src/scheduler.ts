import type { Client } from "discord.js";
import { db } from "./db.js";
import { publishTopicQuestions } from "./services/poll-publisher.js";

const schedulerIntervalMs = 60_000;

export function startScheduler(client: Client) {
  void runDueTopics(client);
  return setInterval(() => void runDueTopics(client), schedulerIntervalMs);
}

async function runDueTopics(client: Client) {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const topics = await db.topic.findMany({
    where: { enabled: true, generationTime: currentTime, channelId: { not: null } }
  });

  for (const topic of topics) {
    if (topic.lastGeneratedAt) {
      const elapsedDays = (now.getTime() - topic.lastGeneratedAt.getTime()) / 86_400_000;
      if (elapsedDays < topic.intervalDays) continue;
    }

    try {
      const channel = await client.channels.fetch(topic.channelId!);
      if (!channel?.isSendable()) continue;
      await publishTopicQuestions(topic, channel);
      console.log(`Scheduled generation completed for ${topic.name}`);
    } catch (error) {
      console.error(`Scheduled generation failed for ${topic.name}`, error);
    }
  }
}
