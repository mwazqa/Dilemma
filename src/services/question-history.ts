import type { Topic } from "@prisma/client";
import { db } from "../db.js";
import { RANDOM_DAILY_LIMIT } from "./quiz-limits.js";
import { storedQuizOptions } from "./quiz-options.js";
import { recentRandomCategories } from "./random-categories.js";
import type { PastQuestion } from "./question-novelty.js";
import type { QuestionFact } from "./question-generator.js";

export const savedQuestionHistoryLimit = 365;
export const randomQuestionHistoryLimit = 365 * RANDOM_DAILY_LIMIT;
const fields = { id: true, question: true, options: true, correctOption: true, createdAt: true } as const;
const answer = (row: { options: string; correctOption: number }) => storedQuizOptions(row.options)[row.correctOption] ?? "";

export async function loadQuestionHistory(guildId: string, topic?: Pick<Topic, "id" | "questionsGenerated">) {
  const [scheduled, random] = await Promise.all([
    db.generatedPoll.findMany({ where: { guildId }, select: { ...fields, topicId: true }, orderBy: { createdAt: "desc" }, take: savedQuestionHistoryLimit }),
    db.randomPoll.findMany({ where: { guildId }, select: { ...fields, category: true }, orderBy: { createdAt: "desc" }, take: randomQuestionHistoryLimit })
  ]);
  const missingOwnHistory = topic && scheduled.filter(row => row.topicId === topic.id).length < Math.min(topic.questionsGenerated, savedQuestionHistoryLimit);
  const own = missingOwnHistory ? await db.generatedPoll.findMany({
    where: { guildId, topicId: topic.id }, select: { ...fields, topicId: true }, orderBy: { createdAt: "desc" }, take: savedQuestionHistoryLimit
  }) : [];
  const rows: PastQuestion[] = [
    ...new Map([...scheduled, ...own].map(row => [row.id, row])).values()
  ].map(row => ({ id: row.id, source: "topic", question: row.question, correctAnswer: answer(row), createdAt: row.createdAt, topicId: row.topicId }));
  rows.push(...random.map(row => ({ id: row.id, source: "random" as const, question: row.question, correctAnswer: answer(row), createdAt: row.createdAt })));
  rows.sort((a, b) => +b.createdAt - +a.createdAt || a.id.localeCompare(b.id));
  return { questions: rows, categories: recentRandomCategories(random.map(row => row.category)) };
}

export async function loadQuestionFacts(guildId: string, candidates: PastQuestion[]): Promise<QuestionFact[]> {
  const scheduledIds = candidates.filter(row => row.source === "topic").map(row => row.id);
  const randomIds = candidates.filter(row => row.source === "random").map(row => row.id);
  const select = { id: true, explanation: true } as const;
  const [scheduled, random] = await Promise.all([
    scheduledIds.length ? db.generatedPoll.findMany({ where: { guildId, id: { in: scheduledIds } }, select, take: 5 }) : [],
    randomIds.length ? db.randomPoll.findMany({ where: { guildId, id: { in: randomIds } }, select, take: 5 }) : []
  ]);
  const details = new Map([...scheduled.map(row => [`topic:${row.id}`, row] as const), ...random.map(row => [`random:${row.id}`, row] as const)]);
  return candidates.map(row => ({ question: row.question, answer: row.correctAnswer, explanation: details.get(`${row.source}:${row.id}`)?.explanation ?? "" }));
}
