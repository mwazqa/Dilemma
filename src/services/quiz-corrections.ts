import type { QuizReport } from "@prisma/client";
import { reportAnalysisCacheSchema, reportAnalysisScopeKey } from "./quiz-report-analysis.js";
import { safeReportText } from "./quiz-report-review.js";
import { scheduleEvents } from "./schedule-events.js";
import { maxWalletValue } from "./sparks.js";
import { walletTransaction } from "./wallet-transaction.js";

export const CORRECTION_BUTTON_PREFIX = "quiz:correct:";
export const CORRECTION_MODAL_PREFIX = "quiz:correction:";
export const CORRECTION_TEXT_MAX = 1000;

export function correctionAnalysis(report: QuizReport) {
  if (!report.reviewedAt || !report.analysis) return null;
  try {
    const cached = reportAnalysisCacheSchema.safeParse(JSON.parse(report.analysis));
    return cached.success && cached.data.scopeKey === reportAnalysisScopeKey(report)
      ? cached.data.analysis : null;
  } catch {
    return null;
  }
}

function cleanCorrection(value: string) {
  return safeReportText(value.trim()).replace(/https:\/\/(?:\w+\.)?discord(?:app)?\.com\/users\/\S+/gi, "[redacted profile]");
}

export function suggestedCorrection(report: QuizReport) {
  const analysis = correctionAnalysis(report);
  return analysis?.kind === "factual" && analysis.verdict === "confirmed" ? cleanCorrection(analysis.suggestion) : "";
}

type Refund = { penalty: number; stake: number; fees: number };
export function refundTotal(refund: Refund) {
  return refund.penalty + refund.stake + refund.fees;
}

export async function approveQuizCorrection(reportId: string, input: string) {
  const text = cleanCorrection(input);
  if (!text || text.length > CORRECTION_TEXT_MAX) return { status: "invalid" as const };
  const result = await walletTransaction(async tx => {
    const report = await tx.quizReport.findUnique({ where: { id: reportId } });
    if (!report || !correctionAnalysis(report)) return { status: "unavailable" as const };
    const identity = { messageId: report.messageId, guildId: report.guildId, channelId: report.channelId };
    const quiz = await tx.quizSettlement.findUnique({ where: identity, select: { scoredAt: true, correction: true } });
    if (!quiz) return { status: "unavailable" as const };
    if (quiz.correction) return { status: "already" as const, correction: quiz.correction };
    if (!quiz.scoredAt) return { status: "pending" as const };

    const { messageId, guildId } = identity;
    const [answers, wagers, charges] = await Promise.all([
      tx.quizAnswer.findMany({ where: { messageId, guildId, sparksPenalty: { gt: 0 } }, select: { userId: true, sparksPenalty: true } }),
      tx.quizWager.findMany({ where: { messageId, guildId }, select: { userId: true, amount: true, payout: true } }),
      tx.quizCharge.findMany({ where: { messageId }, select: { userId: true, fees: true } })
    ]);
    if (wagers.some(wager => wager.payout === null)) return { status: "pending" as const };
    const refunds = new Map<string, Refund>();
    const forUser = (userId: string) => {
      const refund = refunds.get(userId) ?? { penalty: 0, stake: 0, fees: 0 };
      refunds.set(userId, refund);
      return refund;
    };
    for (const answer of answers) forUser(answer.userId).penalty = answer.sparksPenalty;
    for (const wager of wagers) {
      const remainingStake = wager.amount - (wager.payout ?? wager.amount);
      if (remainingStake > 0) forUser(wager.userId).stake = remainingStake;
    }
    for (const charge of charges) forUser(charge.userId).fees = charge.fees;
    const players = [...refunds.keys()].sort();
    const wallets = players.length ? await tx.userScore.findMany({ where: { guildId, userId: { in: players } },
      select: { userId: true, sparks: true } }) : [];
    const balances = new Map(wallets.map(wallet => [wallet.userId, wallet.sparks]));
    if (players.some(userId => (balances.get(userId) ?? 0) + refundTotal(refunds.get(userId)!) > maxWalletValue)) {
      return { status: "balance-limit" as const };
    }
    const refundedSparks = [...refunds.values()].reduce((total, refund) => total + BigInt(refundTotal(refund)), 0n);
    const correction = await tx.quizCorrection.create({ data: { messageId, reportId, text, refundedSparks, refundedPlayers: players.length } });
    for (const userId of players) {
      const amount = refundTotal(refunds.get(userId)!);
      await tx.userScore.upsert({ where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, sparks: amount }, update: { sparks: { increment: amount } } });
    }
    if (players.length) await tx.quizRefund.createMany({ data: players.map(userId => ({ messageId, userId, ...refunds.get(userId)! })) });
    return { status: "approved" as const, correction };
  });
  if (result.status === "approved" || (result.status === "already" && !result.correction.publishedAt)) {
    scheduleEvents.emit("quizCorrectionApproved", result.correction.messageId);
  }
  return result;
}
