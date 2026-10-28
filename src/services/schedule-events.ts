import { EventEmitter } from "node:events";
import type { QuizSettlement, Topic } from "@prisma/client";

export type TopicSchedule = Pick<Topic, "id" | "guildId" | "enabled" | "channelId" | "generationTime" | "startDate" | "lastGeneratedAt" | "intervalDays"> & { timezone?: string };
export type SettlementSchedule = Pick<QuizSettlement, "messageId" | "expiresAt" | "closedAt" | "scoredAt" | "resultsPending" | "nextCheckAt">;

export const scheduleEvents = new EventEmitter<{
  topicChanged: [topic: TopicSchedule];
  topicDeleted: [id: string];
  guildTimezoneChanged: [guildId: string, timezone: string];
  randomPollPublished: [guildId: string];
  randomCooldownChanged: [guildId: string];
  randomNotificationsChanged: [guildId: string];
  settlementChanged: [quiz: SettlementSchedule];
  settlementClosed: [messageId: string, at: Date];
}>();

export function settlementDeadline(quiz: SettlementSchedule): number | null {
  if (quiz.scoredAt && !quiz.resultsPending) return null;
  return Math.max(quiz.closedAt ? 0 : +quiz.expiresAt, +quiz.nextCheckAt);
}
