import { createHash } from "node:crypto";
import { Prisma, type QuizSettlement } from "@prisma/client";
import { Routes, type Client, type MessageCreateOptions } from "discord.js";
import { db } from "../db.js";
import { getResultMessage } from "../brand.js";
import { storedQuizOptions } from "./quiz-options.js";
import { quizClosureSummary } from "./quiz-closure.js";

type ResultQuiz = Pick<QuizSettlement, "messageId" | "guildId" | "channelId">;

export async function publishQuizResults(client: Client, quiz: ResultQuiz, language: string,
  send?: (payload: MessageCreateOptions) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const generated = await tx.generatedPoll.findUnique({ where: { messageId: quiz.messageId } });
        const poll = generated ?? await tx.randomPoll.findUnique({ where: { messageId: quiz.messageId } });
        if (!poll || poll.guildId !== quiz.guildId || poll.channelId !== quiz.channelId) throw new Error("Quiz result metadata mismatch");
        const settlement = poll.closedAt ? null : await tx.quizSettlement.findUnique({ where: { messageId: quiz.messageId } });
        const closure = poll.closedAt ? { closedAt: poll.closedAt, closedByUserId: poll.closedByUserId, closeSource: poll.closeSource }
          : { closedAt: settlement?.closedAt ?? null, closedByUserId: null,
            closeSource: settlement?.scoredAt && settlement.closedAt && settlement.closedAt >= settlement.expiresAt ? "automatic" : "unknown" };
        const request = { where: { messageId: quiz.messageId, guildId: quiz.guildId, channelId: quiz.channelId, endedAt: null }, data: { endedAt: new Date(), ...closure } };
        const claim = generated ? await tx.generatedPoll.updateMany(request) : await tx.randomPoll.updateMany(request);
        if (claim.count) {
          const answer = storedQuizOptions(poll.options)[poll.correctOption];
          if (answer === undefined) throw new Error("Quiz result answer missing");
          const content = getResultMessage(language, answer, poll.explanation, poll.optionEmojis.split("||")[poll.correctOption] ?? "")
            + `\n\n${quizClosureSummary(language, closure)}`;
          const nonce = createHash("sha256").update(`quiz-result:${quiz.messageId}`).digest("hex").slice(0, 25);
          if (send) await send({ content, allowedMentions: { parse: [] }, nonce, enforceNonce: true });
          else await client.rest.post(Routes.channelMessages(quiz.channelId), {
            body: { content, allowed_mentions: { parse: [] }, nonce, enforce_nonce: true }, signal: AbortSignal.timeout(10_000)
          });
        }
        await tx.quizSettlement.updateMany({ where: { messageId: quiz.messageId, guildId: quiz.guildId, channelId: quiz.channelId, resultsPending: true },
          data: { resultsPending: false } });
        return claim.count > 0;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
