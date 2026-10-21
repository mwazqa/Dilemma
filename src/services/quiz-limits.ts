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

export class TopicScheduleNotReadyError extends Error {
  constructor() { super("Topic schedule has no unconsumed publication slot"); this.name = "TopicScheduleNotReadyError"; }
}

export const RANDOM_COOLDOWN_MS = 8 * 60 * 60 * 1000;
export const RANDOM_DAILY_LIMIT = 2;
const randomDailyScope = "random-daily";
export type QuizRun = DailyQuizRun & { dailyRun?: DailyQuizRun; cycleRun?: DailyQuizRun };

export class RandomQuizCooldownError extends Error {
  constructor(public readonly retryAt: Date) {
    super("Random quiz cooldown active");
    this.name = "RandomQuizCooldownError";
  }
}

async function randomUsage(tx: Prisma.TransactionClient, guildId: string, now: Date, exclude: DailyQuizRun[] = []) {
  const { day, start, end } = quizDayBounds(now);
  const cutoff = new Date(now.getTime() - RANDOM_COOLDOWN_MS);
  const [poll, stored] = await Promise.all([
    tx.randomPoll.findFirst({ where: { guildId, createdAt: { gt: cutoff } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    tx.dailyQuizRun.findMany({ where: { guildId, scope: { in: ["random", randomDailyScope] },
      createdAt: { gte: new Date(Math.min(+start, +cutoff)) } } })
  ]);
  const rows = stored.filter(row => !exclude.some(item => item.guildId === row.guildId && item.scope === row.scope &&
    item.day === row.day && item.slot === row.slot));
  const today = rows.filter(row => row.createdAt >= start && row.createdAt < end);
  const daily = today.filter(row => row.scope === randomDailyScope || row.day !== "cooldown");
  const recorded = daily.flatMap(row => row.messageId ? [row.messageId] : []);
  const legacyCount = await tx.randomPoll.count({ where: { guildId, createdAt: { gte: start, lt: end },
    ...(recorded.length ? { messageId: { notIn: recorded } } : {}) } });
  const pending = today.filter(row => row.scope === "random" && row.day === "cooldown" && !row.messageId &&
    !daily.some(item => !item.messageId && +item.createdAt === +row.createdAt));
  return { day, daily, pending, used: daily.length + legacyCount + pending.length,
    latest: Math.max(poll?.createdAt.getTime() ?? 0, ...rows.map(row => +row.createdAt)) };
}

async function claimRandomQuiz(guildId: string, now: Date): Promise<QuizRun> {
  const key = { guildId, scope: "random", day: "cooldown", slot: 1 };
  try {
    return await db.$transaction(async tx => {
      const usage = await randomUsage(tx, guildId, now);
      if (usage.used >= RANDOM_DAILY_LIMIT) throw new DailyQuizLimitError("random");
      const cutoff = new Date(now.getTime() - RANDOM_COOLDOWN_MS);
      if (usage.latest > +cutoff) throw new RandomQuizCooldownError(new Date(usage.latest + RANDOM_COOLDOWN_MS));
      const updated = await tx.dailyQuizRun.updateMany({ where: { ...key, createdAt: { lte: cutoff } },
        data: { createdAt: now, messageId: null } });
      const run = updated.count ? { ...key, createdAt: now, messageId: null }
        : await tx.dailyQuizRun.create({ data: { ...key, createdAt: now } });
      const occupied = new Set(usage.daily.filter(row => row.scope === randomDailyScope && row.day === usage.day).map(row => row.slot));
      for (const pending of usage.pending) {
        const slot = Array.from({ length: RANDOM_DAILY_LIMIT }, (_, index) => index + 1).find(value => !occupied.has(value));
        if (!slot) throw new DailyQuizLimitError("random");
        await tx.dailyQuizRun.create({ data: { guildId, scope: randomDailyScope, day: usage.day, slot, createdAt: pending.createdAt } });
        occupied.add(slot);
      }
      for (let slot = 1; slot <= RANDOM_DAILY_LIMIT; slot++) {
        if (occupied.has(slot)) continue;
        const dailyRun = await tx.dailyQuizRun.create({ data: { guildId, scope: randomDailyScope, day: usage.day, slot, createdAt: now } });
        return { ...run, dailyRun };
      }
      throw new DailyQuizLimitError("random");
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const current = await db.dailyQuizRun.findUnique({ where: { guildId_scope_day_slot: key } });
    throw new RandomQuizCooldownError(new Date((current?.createdAt ?? now).getTime() + RANDOM_COOLDOWN_MS));
  }
}

export async function refreshRandomQuizRun(run: QuizRun): Promise<QuizRun> {
  const dailyRun = run.dailyRun;
  if (!dailyRun) throw new Error("Missing random daily reservation");
  const createdAt = new Date();
  return db.$transaction(async tx => {
    const updated = await tx.dailyQuizRun.updateMany({ where: { ...runKey(run).guildId_scope_day_slot,
      createdAt: run.createdAt, messageId: null }, data: { createdAt } });
    if (!updated.count) throw new RandomQuizCooldownError(new Date(createdAt.getTime() + RANDOM_COOLDOWN_MS));
    const usage = await randomUsage(tx, run.guildId, createdAt, [run, dailyRun]);
    if (usage.used >= RANDOM_DAILY_LIMIT) throw new DailyQuizLimitError("random");
    const refreshed = await tx.dailyQuizRun.updateMany({ where: { ...runKey(dailyRun).guildId_scope_day_slot,
      createdAt: dailyRun.createdAt, messageId: null }, data: { createdAt } });
    if (!refreshed.count) throw new Error("Random daily reservation changed");
    return { ...run, createdAt, dailyRun: { ...dailyRun, createdAt } };
  });
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

export function isScheduleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

type TopicCalendar = {
  generationTime: string | null; lastGeneratedAt: Date | null; intervalDays: number; startDate?: string | null
};

function calendarDay(day: string, offset: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
}

function publicationAt(day: string, time: string): number {
  const end = +dayStart(calendarDay(day, 1));
  for (let at = +dayStart(day); at < end; at += 60_000) {
    if (timeFormatter.format(new Date(at)) >= time) return at;
  }
  return end;
}

function latestPublicationDay(topic: TopicCalendar, now: Date, early: boolean): string | null {
  const start = topic.startDate!;
  const days = (Date.parse(quizDay(now)) - Date.parse(start)) / 86_400_000;
  let cycle = Math.floor(days / topic.intervalDays);
  if (cycle < 0) return null;
  let day = calendarDay(start, cycle * topic.intervalDays);
  if (!early && +now < publicationAt(day, topic.generationTime!)) {
    if (--cycle < 0) return null;
    day = calendarDay(start, cycle * topic.intervalDays);
  }
  return day;
}

export function isTopicDue(topic: TopicCalendar, now: Date, early = false): boolean {
  if (topic.startDate) {
    if (!isScheduleDate(topic.startDate) || !topic.generationTime || !isGenerationTime(topic.generationTime)) return false;
    const day = latestPublicationDay(topic, now, early);
    return day !== null && (!topic.lastGeneratedAt || quizDay(topic.lastGeneratedAt) < day);
  }
  if (!topic.generationTime || timeFormatter.format(now) < topic.generationTime) return false;
  if (!topic.lastGeneratedAt) return true;
  const days = (Date.parse(quizDay(now)) - Date.parse(quizDay(topic.lastGeneratedAt))) / 86_400_000;
  return days >= topic.intervalDays;
}

export function nextTopicRunAt(topic: {
  enabled: boolean; channelId: string | null; generationTime: string | null;
  lastGeneratedAt: Date | null; intervalDays: number; startDate?: string | null
}, now = new Date()): number | null {
  if (!topic.enabled || !topic.channelId || !topic.generationTime || !isGenerationTime(topic.generationTime)) return null;
  if (topic.startDate && !isScheduleDate(topic.startDate)) return null;
  if (isTopicDue(topic, now)) return +now;
  if (topic.startDate) {
    const today = quizDay(now);
    const afterLast = topic.lastGeneratedAt ? calendarDay(quizDay(topic.lastGeneratedAt), 1) : topic.startDate;
    const earliest = today > afterLast ? today : afterLast;
    const cycle = Math.max(0, Math.ceil((Date.parse(earliest) - Date.parse(topic.startDate)) / (86_400_000 * topic.intervalDays)));
    return publicationAt(calendarDay(topic.startDate, cycle * topic.intervalDays), topic.generationTime);
  }
  const today = quizDay(now);
  const eligible = topic.lastGeneratedAt
    ? new Date(Date.parse(quizDay(topic.lastGeneratedAt)) + topic.intervalDays * 86_400_000).toISOString().slice(0, 10)
    : today;
  const day = eligible > today ? eligible : today;
  const nextDay = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
  const end = +dayStart(nextDay);
  for (let at = +dayStart(day); at < end; at += 60_000) {
    if (at >= +now && timeFormatter.format(new Date(at)) >= topic.generationTime) return at;
  }
  return +dayStart(nextDay);
}

export function validatePollDuration(hours: number): number {
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("Invalid poll duration");
  return hours;
}

export async function claimQuizRun(guildId: string, topicId?: string, now = new Date(), early = true): Promise<QuizRun> {
  if (!topicId) return claimRandomQuiz(guildId, now);
  const { day, start, end } = quizDayBounds(now);
  const scope = topicId ? `topic:${topicId}` : "random";
  const kind = "topic";
  const limit = 1;
  const runs = await db.dailyQuizRun.findMany({ where: { guildId, scope, day } });
  const recordedMessages = runs.flatMap(run => run.messageId ? [run.messageId] : []);
  const where = { guildId, createdAt: { gte: start, lt: end },
    ...(recordedMessages.length ? { messageId: { notIn: recordedMessages } } : {}) };
  const legacyCount = await db.generatedPoll.count({ where: { ...where, topicId } });
  const topic = await db.topic.findUnique({ where: { id: topicId } });
  if (topic?.lastGeneratedAt && quizDay(topic.lastGeneratedAt) === day) throw new DailyQuizLimitError(kind);
  if (topic?.startDate) {
    if (!isTopicDue(topic, now, early)) throw new TopicScheduleNotReadyError();
    if (runs.length || legacyCount) throw new DailyQuizLimitError(kind);
    const cycleDay = latestPublicationDay(topic, now, early)!;
    try {
      return await db.$transaction(async tx => {
        const run = await tx.dailyQuizRun.create({ data: { guildId, scope, day, slot: 1 } });
        const cycleRun = await tx.dailyQuizRun.create({ data: { guildId, scope: `topic-cycle:${topicId}`, day: cycleDay, slot: 1 } });
        return { ...run, cycleRun };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      throw new TopicScheduleNotReadyError();
    }
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

export async function releaseQuizRun(run: QuizRun) {
  const where = { ...runKey(run).guildId_scope_day_slot, createdAt: run.createdAt, messageId: null };
  const pairedRun = run.dailyRun ?? run.cycleRun;
  if (!pairedRun) { await db.dailyQuizRun.deleteMany({ where }); return; }
  await db.$transaction(async tx => {
    const removed = await tx.dailyQuizRun.deleteMany({ where });
    if (removed.count) await tx.dailyQuizRun.deleteMany({ where: { ...runKey(pairedRun).guildId_scope_day_slot,
      createdAt: pairedRun.createdAt, messageId: null } });
  });
}
