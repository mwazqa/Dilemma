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

export const RANDOM_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export class RandomQuizCooldownError extends Error {
  constructor(public readonly retryAt: Date) {
    super("Random quiz cooldown active");
    this.name = "RandomQuizCooldownError";
  }
}

async function claimRandomQuiz(guildId: string, now: Date): Promise<DailyQuizRun> {
  const cutoff = new Date(now.getTime() - RANDOM_COOLDOWN_MS);
  // Reuse quota storage with one rolling row. Include pre-upgrade polls and reservations.
  const [poll, reservations] = await Promise.all([
    db.randomPoll.findFirst({ where: { guildId, createdAt: { gt: cutoff } }, orderBy: { createdAt: "desc" } }),
    db.dailyQuizRun.findMany({ where: { guildId, scope: "random", createdAt: { gt: cutoff } },
      orderBy: { createdAt: "desc" }, take: 1 })
  ]);
  const latest = Math.max(poll?.createdAt.getTime() ?? 0, reservations[0]?.createdAt.getTime() ?? 0);
  if (latest > cutoff.getTime()) throw new RandomQuizCooldownError(new Date(latest + RANDOM_COOLDOWN_MS));
  const key = { guildId, scope: "random", day: "cooldown", slot: 1 };
  const updated = await db.dailyQuizRun.updateMany({ where: { ...key, createdAt: { lte: cutoff } },
    data: { createdAt: now, messageId: null } });
  if (updated.count) return { ...key, createdAt: now, messageId: null };
  try { return await db.dailyQuizRun.create({ data: { ...key, createdAt: now } }); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const current = await db.dailyQuizRun.findUnique({ where: { guildId_scope_day_slot: key } });
    throw new RandomQuizCooldownError(new Date((current?.createdAt ?? now).getTime() + RANDOM_COOLDOWN_MS));
  }
}

export async function refreshRandomQuizRun(run: DailyQuizRun): Promise<DailyQuizRun> {
  const createdAt = new Date();
  const updated = await db.dailyQuizRun.updateMany({ where: { ...runKey(run).guildId_scope_day_slot,
    createdAt: run.createdAt, messageId: null }, data: { createdAt } });
  if (!updated.count) throw new RandomQuizCooldownError(new Date(createdAt.getTime() + RANDOM_COOLDOWN_MS));
  return { ...run, createdAt };
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

export function isGenerationTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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
  if (!topicId) return claimRandomQuiz(guildId, now);
  const { day, start, end } = quizDayBounds(now);
  const scope = topicId ? `topic:${topicId}` : "random";
  const kind = "topic";
  const limit = 1;
  const runs = await db.dailyQuizRun.findMany({ where: { guildId, scope, day } });
  const recordedMessages = runs.flatMap(run => run.messageId ? [run.messageId] : []);
  const where = { guildId, createdAt: { gte: start, lt: end },
    ...(recordedMessages.length ? { messageId: { notIn: recordedMessages } } : {}) };
  // Existing polls also consume quota after migration. Completed reservations are not counted twice.
  const legacyCount = await db.generatedPoll.count({ where: { ...where, topicId } });
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
  await db.dailyQuizRun.deleteMany({ where: { guildId: run.guildId, scope: run.scope, day: run.day, slot: run.slot,
    createdAt: run.createdAt, messageId: null } });
}
