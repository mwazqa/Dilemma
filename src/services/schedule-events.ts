import { EventEmitter } from "node:events";
import type { QuizSettlement, Topic } from "@prisma/client";

export type TopicSchedule = Pick<Topic, "id" | "enabled" | "channelId" | "generationTime" | "lastGeneratedAt" | "intervalDays">;
export type SettlementSchedule = Pick<QuizSettlement, "messageId" | "expiresAt" | "closedAt" | "scoredAt" | "nextCheckAt">;

export const scheduleEvents = new EventEmitter<{
  topicChanged: [topic: TopicSchedule];
  topicDeleted: [id: string];
  settlementChanged: [quiz: SettlementSchedule];
  settlementClosed: [messageId: string, at: Date];
}>();

export function settlementDeadline(quiz: SettlementSchedule): number | null {
  if (quiz.scoredAt) return null;
  return Math.max(quiz.closedAt ? 0 : +quiz.expiresAt, +quiz.nextCheckAt);
}
