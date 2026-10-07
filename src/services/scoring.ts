import { Routes, type Client, type Message, type APIMessage, type APIUser } from "discord.js";
import { Prisma, type QuizSettlement } from "@prisma/client";
import { db } from "../db.js";
import { parseDifficulty } from "../difficulty.js";

const pointsByDifficulty = { easy: 1, medium: 2, hard: 3 } as const;
export type FinalVote = { userId: string; answerId: number };

export function settlementData(message: Message, guildId: string, difficulty: string, options: string[], correctOption: number) {
  const poll = message.poll;
  if (!poll || poll.allowMultiselect || !poll.expiresAt || options[correctOption] === undefined) throw new Error("Invalid quiz poll metadata");
  const answers = [...poll.answers.values()];
  if (answers.length !== options.length) throw new Error("Poll answer count mismatch");
  const mapped = options.map(text => {
    const matches = answers.filter(answer => answer.text === text);
    if (matches.length !== 1) throw new Error("Poll answer mapping mismatch");
    return matches[0].id;
  });
  return { messageId: message.id, guildId, channelId: message.channelId, difficulty: parseDifficulty(difficulty),
    correctAnswerId: mapped[correctOption], answerIds: mapped.join(","), expiresAt: poll.expiresAt };
}

export function scoreHistory(history: { correct: boolean; points: number }[]) {
  let currentStreak = 0;
  let bestStreak = 0;
  let correct = 0;
  let points = 0;
  for (const answer of history) {
    points += answer.points;
    if (answer.correct) { correct++; currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
    else currentStreak = 0;
  }
  return { points, answered: history.length, correct, currentStreak, bestStreak };
}

export async function collectFinalVotes(client: Client, quiz: QuizSettlement): Promise<{ votes: FinalVote[]; finishedAt: Date } | null> {
  const message = await client.rest.get(Routes.channelMessage(quiz.channelId, quiz.messageId)) as APIMessage;
  if (message.author.id !== client.user?.id || message.id !== quiz.messageId || message.channel_id !== quiz.channelId) throw new Error("Quiz ownership mismatch");
  const poll = message.poll;
  if (!poll || poll.allow_multiselect) throw new Error("Invalid scored poll");
  if (!poll.expiry || Date.parse(poll.expiry) > Date.now() || !poll.results?.is_finalized) return null;
  const expected = quiz.answerIds.split(",").map(Number).sort((a, b) => a - b);
  const actual = poll.answers.map(answer => answer.answer_id).sort((a, b) => a - b);
  if (JSON.stringify(expected) !== JSON.stringify(actual) || !expected.includes(quiz.correctAnswerId)) throw new Error("Quiz answers changed");
  const votes = new Map<string, number>();
  for (const answer of poll.answers) {
    const voters = new Map<string, APIUser>();
    let after: string | undefined;
    while (true) {
      const query = new URLSearchParams({ limit: "100", ...(after ? { after } : {}) });
      const page = await client.rest.get(Routes.pollAnswerVoters(quiz.channelId, quiz.messageId, answer.answer_id), { query }) as { users: APIUser[] };
      for (const user of page.users) voters.set(user.id, user);
      if (page.users.length < 100) break;
      const next = page.users.map(user => user.id).reduce((max, id) => BigInt(id) > BigInt(max) ? id : max);
      if (after && BigInt(next) <= BigInt(after)) throw new Error("Voter pagination did not advance");
      after = next;
    }
    const expectedCount = poll.results.answer_counts.find(count => count.id === answer.answer_id)?.count ?? 0;
    if (voters.size !== expectedCount) throw new Error("Final voter count mismatch; retry later");
    for (const user of voters.values()) {
      if (user.bot) continue;
      if (votes.has(user.id)) throw new Error("User has multiple answers; retry later");
      votes.set(user.id, answer.answer_id);
    }
  }
  return { votes: [...votes].map(([userId, answerId]) => ({ userId, answerId })), finishedAt: new Date(poll.expiry) };
}

export async function applyFinalVotes(quiz: QuizSettlement, votes: FinalVote[], finishedAt: Date) {
  if (new Set(votes.map(vote => vote.userId)).size !== votes.length || votes.some(vote => !quiz.answerIds.split(",").map(Number).includes(vote.answerId))) {
    throw new Error("Invalid final votes");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const claim = await tx.quizSettlement.updateMany({ where: { messageId: quiz.messageId, scoredAt: null }, data: { scoredAt: new Date(), closedAt: finishedAt } });
        if (!claim.count) return false;
        for (const vote of votes) {
          const correct = vote.answerId === quiz.correctAnswerId;
          await tx.quizAnswer.create({ data: { ...vote, guildId: quiz.guildId, messageId: quiz.messageId, correct,
            points: correct ? pointsByDifficulty[parseDifficulty(quiz.difficulty)] : 0, finishedAt } });
          const history = await tx.quizAnswer.findMany({ where: { guildId: quiz.guildId, userId: vote.userId },
            select: { correct: true, points: true }, orderBy: [{ finishedAt: "asc" }, { messageId: "asc" }] });
          const score = scoreHistory(history);
          await tx.userScore.upsert({ where: { guildId_userId: { guildId: quiz.guildId, userId: vote.userId } },
            create: { guildId: quiz.guildId, userId: vote.userId, ...score }, update: score });
        }
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  return false;
}

let running = false;
export async function runDueSettlements(client: Client) {
  if (running) return;
  running = true;
  try {
    const quizzes = await db.quizSettlement.findMany({ where: { scoredAt: null, nextCheckAt: { lte: new Date() }, OR: [{ expiresAt: { lte: new Date() } }, { closedAt: { not: null } }] },
      orderBy: [{ nextCheckAt: "asc" }, { messageId: "asc" }], take: 25 });
    for (const quiz of quizzes) {
      try {
        await db.quizSettlement.updateMany({ where: { messageId: quiz.messageId, scoredAt: null }, data: { nextCheckAt: new Date(Date.now() + 300_000) } });
        const final = await collectFinalVotes(client, quiz);
        if (final) await applyFinalVotes(quiz, final.votes, final.finishedAt);
        else await db.quizSettlement.updateMany({ where: { messageId: quiz.messageId, scoredAt: null }, data: { nextCheckAt: new Date(Date.now() + 60_000) } });
      } catch (error) { console.error("Quiz scoring pending:", privateErrorSummary(error)); }
    }
  } catch (error) { console.error("Quiz scoring check failed:", privateErrorSummary(error)); }
  finally { running = false; }
}

export function startScoreScheduler(client: Client) {
  void runDueSettlements(client);
  return setInterval(() => void runDueSettlements(client), 60_000);
}
import { privateErrorSummary } from "../private-errors.js";
