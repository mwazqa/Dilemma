import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type QuizSettlement } from "@prisma/client";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { db } from "../db.js";
import { message } from "../messages.js";
import { END_QUIZ_BUTTON_ID } from "./poll-controls.js";
import { renderQuizCard } from "./quiz-card.js";
import { privateErrorSummary } from "../private-errors.js";

export const VOTE_PREFIX = "quiz:vote:";
export const WITHDRAW_VOTE_ID = "quiz:withdraw";
export const REVEAL_VOTES_ID = "quiz:reveal";
export const FIFTY_FIFTY_ID = "quiz:fifty";
export const WAGER_BUTTON_ID = "quiz:wager";
export const WAGER_MODAL_PREFIX = "quiz:wager:";
export const MAX_WAGER = 20;
export const WITHDRAW_COST = 1;
export const REVEAL_COST = 5;
export const FIFTY_FIFTY_COST = 5;
type Identity = Pick<QuizSettlement, "messageId" | "guildId" | "channelId">;

export async function quizVotingPayload(question: { question: string; options: string[]; optionEmojis: string[] }, expiresAt: Date, language: string, imageAllowed = true) {
  if (question.options.length < 2 || question.options.length > 4) throw new Error("Invalid quiz answer count");
  const answers = new ActionRowBuilder<ButtonBuilder>().addComponents(question.options.map((option, index) => {
    const button = new ButtonBuilder().setCustomId(`${VOTE_PREFIX}${index + 1}`).setLabel(`${index + 1}. ${option}`).setStyle(ButtonStyle.Primary);
    if (question.optionEmojis[index]) button.setEmoji(question.optionEmojis[index]);
    return button;
  }));
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WITHDRAW_VOTE_ID).setLabel(message(language, "withdrawVoteButton", { cost: WITHDRAW_COST })).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(REVEAL_VOTES_ID).setLabel(message(language, "revealVotesButton", { cost: REVEAL_COST })).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(FIFTY_FIFTY_ID).setLabel(message(language, "fiftyFiftyButton", { cost: FIFTY_FIFTY_COST }))
      .setStyle(ButtonStyle.Secondary).setDisabled(question.options.length < 3)
  );
  const finish = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WAGER_BUTTON_ID).setLabel(message(language, "wagerButton")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(END_QUIZ_BUTTON_ID).setLabel(message(language, "endQuizButton")).setStyle(ButtonStyle.Danger)
  );
  const description = question.question + "\n" + question.options.map((option, index) => `${index + 1}. ${option}`).join("\n")
    + `\n${message(language, "votingEnds", { time: expiresAt.toISOString() })}`;
  const embed = new EmbedBuilder().setColor(0xad94f3);
  if (!imageAllowed) return { embeds: [embed.setDescription(description)], components: [answers, controls, finish], files: [] };
  try {
    const card = await renderQuizCard(question.question, question.options, Math.max(1, Math.min(24, Math.ceil((+expiresAt - Date.now()) / 3_600_000))));
    const attachment = new AttachmentBuilder(card, { name: "quiz.png", description });
    embed.setImage("attachment://quiz.png");
    return { embeds: [embed], components: [answers, controls, finish], files: [attachment] };
  } catch (error) {
    console.warn("Quiz image unavailable:", privateErrorSummary(error));
    embed.setDescription(description);
    return { embeds: [embed], components: [answers, controls, finish], files: [] };
  }
}

export function buttonSettlementData(identity: Identity, difficulty: string, optionCount: number, correctOption: number, expiresAt: Date) {
  return { ...identity, difficulty, correctAnswerId: correctOption + 1,
    answerIds: Array.from({ length: optionCount }, (_, index) => index + 1).join(","), expiresAt, votingMode: "buttons", resultsPending: true };
}

async function quizTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code) || attempt >= 4) throw error;
      await delay(10 * 2 ** attempt + randomInt(10));
    }
  }
}

async function lockActiveQuiz(tx: Prisma.TransactionClient, identity: Identity) {
  const claim = await tx.quizSettlement.updateMany({ where: { ...identity, votingMode: "buttons", scoredAt: null,
    closedAt: null, expiresAt: { gt: new Date() } }, data: { votingMode: "buttons" } });
  if (!claim.count) return null;
  const quiz = await tx.quizSettlement.findUnique({ where: { messageId: identity.messageId } });
  return quiz && quiz.expiresAt.getTime() > Date.now() ? quiz : null;
}

async function spendSparks(tx: Prisma.TransactionClient, guildId: string, userId: string, cost: number) {
  if (!cost) return true;
  const paid = await tx.userScore.updateMany({ where: { guildId, userId, sparks: { gte: cost } }, data: { sparks: { decrement: cost } } });
  return paid.count > 0;
}

export async function castQuizVote(identity: Identity, userId: string, answerId: number | null) {
  return quizTransaction(async tx => {
    const quiz = await lockActiveQuiz(tx, identity);
    if (!quiz) return { status: "closed" as const, charged: 0 };
    if (answerId !== null && !quiz.answerIds.split(",").map(Number).includes(answerId)) return { status: "invalid" as const, charged: 0 };
    const key = { messageId: quiz.messageId, userId };
    const current = await tx.quizVote.findUnique({ where: { messageId_userId: key } });
    if (answerId === null && !current) return { status: "missing" as const, charged: 0 };
    if (current?.answerId === answerId) return { status: "unchanged" as const, charged: 0 };
    if (answerId !== null) {
      const support = await tx.quizSupport.findUnique({ where: { messageId_userId: key } });
      if (support?.hintAnswerIds && !support.hintAnswerIds.split(",").map(Number).includes(answerId)) return { status: "eliminated" as const, charged: 0 };
    }
    const cost = current ? WITHDRAW_COST : 0;
    const wager = await tx.quizWager.findUnique({ where: { messageId_userId: key } });
    const refunded = answerId === null ? wager?.amount ?? 0 : 0;
    if (refunded) {
      const returned = await tx.userScore.updateMany({ where: { guildId: quiz.guildId, userId, sparks: { gte: Math.max(0, cost - refunded) } },
        data: { sparks: { increment: refunded - cost } } });
      if (!returned.count) throw new Error("Wager wallet unavailable");
    } else if (!await spendSparks(tx, quiz.guildId, userId, cost)) return { status: "insufficient" as const, charged: 0 };
    if (answerId === null) {
      await tx.quizVote.delete({ where: { messageId_userId: key } });
      if (wager) await tx.quizWager.delete({ where: { messageId_userId: key } });
    } else {
      await tx.quizVote.upsert({ where: { messageId_userId: key }, create: { ...key, guildId: quiz.guildId, answerId }, update: { answerId } });
      if (wager) await tx.quizWager.update({ where: { messageId_userId: key }, data: { answerId } });
    }
    return { status: answerId === null ? "withdrawn" as const : "voted" as const, charged: cost, refunded };
  });
}

export async function placeQuizWager(identity: Identity, userId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_WAGER) return { status: "invalid" as const };
  return quizTransaction(async tx => {
    const quiz = await lockActiveQuiz(tx, identity);
    if (!quiz) return { status: "closed" as const };
    const key = { messageId: quiz.messageId, userId };
    const vote = await tx.quizVote.findUnique({ where: { messageId_userId: key } });
    if (!vote) return { status: "missing" as const };
    const existing = await tx.quizWager.findUnique({ where: { messageId_userId: key } });
    if (existing) return { status: "existing" as const, amount: existing.amount, answerId: existing.answerId };
    if (!await spendSparks(tx, quiz.guildId, userId, amount)) return { status: "insufficient" as const };
    await tx.quizWager.create({ data: { ...key, guildId: quiz.guildId, answerId: vote.answerId, amount } });
    return { status: "placed" as const, amount, answerId: vote.answerId };
  });
}

export async function useQuizTool(identity: Identity, userId: string, kind: "reveal" | "fifty") {
  return quizTransaction(async tx => {
    const quiz = await lockActiveQuiz(tx, identity);
    if (!quiz) return { status: "closed" as const };
    const answerIds = quiz.answerIds.split(",").map(Number);
    if (kind === "fifty" && answerIds.length < 3) return { status: "unavailable" as const };
    const key = { messageId: quiz.messageId, userId };
    const support = await tx.quizSupport.findUnique({ where: { messageId_userId: key } });
    const unlocked = kind === "reveal" ? support?.revealed : Boolean(support?.hintAnswerIds);
    const cost = kind === "reveal" ? REVEAL_COST : FIFTY_FIFTY_COST;
    let hintAnswerIds = support?.hintAnswerIds ?? null;
    if (!unlocked) {
      if (!await spendSparks(tx, quiz.guildId, userId, cost)) return { status: "insufficient" as const };
      if (kind === "fifty") {
        const wrong = answerIds.filter(id => id !== quiz.correctAnswerId);
        hintAnswerIds = [quiz.correctAnswerId, wrong[randomInt(wrong.length)]].sort((a, b) => a - b).join(",");
      }
      const update = kind === "reveal" ? { revealed: true } : { hintAnswerIds };
      await tx.quizSupport.upsert({ where: { messageId_userId: key }, create: { ...key, guildId: quiz.guildId, ...update }, update });
    }
    if (kind === "fifty") return { status: "hint" as const, answerIds: hintAnswerIds!.split(",").map(Number) };
    const votes = await tx.quizVote.groupBy({ by: ["answerId"], where: { messageId: quiz.messageId, guildId: quiz.guildId }, _count: { _all: true } });
    return { status: "revealed" as const, counts: answerIds.map(id => votes.find(vote => vote.answerId === id)?._count._all ?? 0) };
  });
}

export function voteBreakdown(language: string, options: string[], counts: number[]) {
  return `${message(language, "voteCounts")}\n` + options.map((option, index) => `${index + 1}. ${option}: **${counts[index] ?? 0}**`).join("\n");
}
