import { Prisma, type DailyQuizRun } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: env.QUIZ_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: env.QUIZ_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export class DailyQuizLimitError extends Error {
  constructor(public readonly kind: "topic" | "random") {
    super("Daily quiz limit reached");
    this.name = "DailyQuizLimitError";
  }
}

export function quizDay(now: Date): string {
  const parts = dayFormatter.formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayStart(day: string): Date {
  const center = Date.parse(day + "T00:00:00Z");
  let low = center - 36 * 3_600_000;
  let high = center + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (quizDay(new Date(middle)) < day) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function quizDayBounds(now: Date) {
  const day = quizDay(now);
  const nextDay = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  return { day, start: dayStart(day), end: dayStart(nextDay) };
}

export function isTopicDue(topic: {
  generationTime: string | null; lastGeneratedAt: Date | null; intervalDays: number
}, now: Date): boolean {
  if (!topic.generationTime || timeFormatter.format(now) < topic.generationTime) return false;
  if (!topic.lastGeneratedAt) return true;
  const days = (Date.parse(quizDay(now)) - Date.parse(quizDay(topic.lastGeneratedAt))) / 86_400_000;
  return days >= topic.intervalDays;
}

export function validatePollDuration(hours: number): number {
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("Invalid poll duration");
  return hours;
}

export async function claimQuizRun(guildId: string, topicId?: string, now = new Date()): Promise<DailyQuizRun> {
  const { day, start, end } = quizDayBounds(now);
  const scope = topicId ? `topic:${topicId}` : "random";
  const kind = topicId ? "topic" : "random";
  const limit = topicId ? 1 : 3;
  const runs = await db.dailyQuizRun.findMany({ where: { guildId, scope, day } });
  const recordedMessages = runs.flatMap(run => run.messageId ? [run.messageId] : []);
  const where = { guildId, createdAt: { gte: start, lt: end },
    ...(recordedMessages.length ? { messageId: { notIn: recordedMessages } } : {}) };
  // Existing polls also consume quota after migration. Completed reservations are not counted twice.
  const legacyCount = topicId
    ? await db.generatedPoll.count({ where: { ...where, topicId } })
    : await db.randomPoll.count({ where });
  if (topicId) {
    const topic = await db.topic.findUnique({ where: { id: topicId } });
    if (topic?.lastGeneratedAt && quizDay(topic.lastGeneratedAt) === day) throw new DailyQuizLimitError(kind);
  }
  for (let slot = legacyCount + 1; slot <= limit; slot++) {
    try { return await db.dailyQuizRun.create({ data: { guildId, scope, day, slot } }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  throw new DailyQuizLimitError(kind);
}

export function runKey(run: DailyQuizRun) {
  return { guildId_scope_day_slot: { guildId: run.guildId, scope: run.scope, day: run.day, slot: run.slot } };
}

export async function releaseQuizRun(run: DailyQuizRun) {
  await db.dailyQuizRun.deleteMany({ where: { guildId: run.guildId, scope: run.scope, day: run.day, slot: run.slot, messageId: null } });
}
