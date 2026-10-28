import type { GeneratedPoll, QuizSettlement } from "@prisma/client";
import type { Poll } from "discord.js";
import { db } from "../db.js";
import { message } from "../messages.js";

type QuizIdentity = Pick<QuizSettlement, "messageId" | "guildId" | "channelId">;
type Closure = Pick<GeneratedPoll, "closedAt" | "closedByUserId" | "closeSource">;

export async function closeQuiz(quiz: QuizIdentity, generated: boolean, userId: string, source: "button" | "command",
  poll: Pick<Poll, "expiresTimestamp" | "end">) {
  if (poll.expiresTimestamp && poll.expiresTimestamp <= Date.now()) return null;
  return db.$transaction(async tx => {
    const identity = { messageId: quiz.messageId, guildId: quiz.guildId, channelId: quiz.channelId };
    const request = { where: { ...identity, endedAt: null, closedAt: null }, data: { closedByUserId: userId, closeSource: source } };
    const claim = generated ? await tx.generatedPoll.updateMany(request) : await tx.randomPoll.updateMany(request);
    if (!claim.count) return null;
    await poll.end();
    const closedAt = new Date();
    const completion = { where: identity, data: { closedAt } };
    if (generated) await tx.generatedPoll.updateMany(completion);
    else await tx.randomPoll.updateMany(completion);
    await tx.quizSettlement.updateMany({ where: { ...identity, scoredAt: null }, data: { closedAt, nextCheckAt: closedAt } });
    return closedAt;
  }, { timeout: 15_000 });
}

export function quizClosureSummary(language: string, closure: Closure) {
  const manual = closure.closedByUserId && (closure.closeSource === "button" || closure.closeSource === "command");
  const description = manual ? message(language, "quizClosedBy", { user: `<@${closure.closedByUserId}>` })
    : message(language, closure.closeSource === "automatic" ? "quizClosedAutomatically" : "quizClosureUnknown");
  return description + (closure.closedAt ? ` · <t:${Math.floor(closure.closedAt.getTime() / 1000)}:f>` : "");
}
