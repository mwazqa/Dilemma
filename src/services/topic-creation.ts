import type { Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../db.js";

export const MAX_TOPICS_PER_GUILD = 31;

export class TopicLimitError extends Error {
  constructor() {
    super("Saved quiz limit reached");
    this.name = "TopicLimitError";
  }
}

export async function createTopic(data: Prisma.TopicCreateInput) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async tx => {
        const count = await tx.topic.count({ where: { guildId: data.guildId } });
        if (count >= MAX_TOPICS_PER_GUILD) throw new TopicLimitError();
        return tx.topic.create({ data });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= 4 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
      await delay(Math.min(25 * 2 ** attempt, 200) + Math.floor(Math.random() * 25));
    }
  }
}
