import { Prisma } from "@prisma/client";
import { db } from "../db.js";

export const REPORT_REASON_MIN = 10;
export const REPORT_REASON_MAX = 1000;
export const REPORT_MODAL_PREFIX = "quiz:report:";
type Identity = { messageId: string; guildId: string; channelId: string };

export async function reportableQuiz(identity: Identity) {
  const saved = await db.generatedPoll.findUnique({ where: { messageId: identity.messageId } });
  const quiz = saved ?? await db.randomPoll.findUnique({ where: { messageId: identity.messageId } });
  return quiz?.guildId === identity.guildId && quiz.channelId === identity.channelId
    ? { ...quiz, source: saved ? "topic" : "random" } : null;
}

export async function recordQuizReport(identity: Identity, reporterUserId: string, reason: string) {
  reason = reason.trim();
  if (reason.length < REPORT_REASON_MIN || reason.length > REPORT_REASON_MAX) return "invalid" as const;
  const quiz = await reportableQuiz(identity);
  if (!quiz) return "missing" as const;
  try {
    await db.quizReport.create({ data: {
      ...identity, reporterUserId, reason, source: quiz.source, question: quiz.question, options: quiz.options,
      correctOption: quiz.correctOption, explanation: quiz.explanation, difficulty: quiz.difficulty, quizCreatedAt: quiz.createdAt
    } });
    return "saved" as const;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await db.quizReport.findUnique({ where: { messageId_reporterUserId: { messageId: identity.messageId, reporterUserId } } });
    if (!existing || existing.guildId !== identity.guildId || existing.channelId !== identity.channelId) throw error;
    return "existing" as const;
  }
}
