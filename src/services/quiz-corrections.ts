import type { QuizReport } from "@prisma/client";
import { reportAnalysisCacheSchema, reportAnalysisScopeKey, type ReportAnalysis } from "./quiz-report-analysis.js";
import { cleanGenerationRule, generationRuleKey } from "./quiz-generation-rules.js";
import { safeReportText } from "./quiz-report-review.js";
import { scoreHistory } from "./scoring.js";
import { maxWalletValue } from "./sparks.js";
import { walletTransaction } from "./wallet-transaction.js";

export const CORRECTION_BUTTON_PREFIX = "quiz:correct:";
export const CORRECTION_ACCEPT_PREFIX = "quiz:accept-correction:";
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

export function suggestedCorrection(analysis: ReportAnalysis) {
  if (analysis.kind !== "factual" || analysis.verdict !== "confirmed") return "";
  const text = cleanCorrection(analysis.suggestion);
  return text.length <= CORRECTION_TEXT_MAX ? text : "";
}

export function suggestedGenerationRule(analysis: ReportAnalysis) {
  if (analysis.verdict !== "confirmed" || (analysis.kind !== "factual" && analysis.kind !== "wording")) return "";
  return cleanGenerationRule(analysis.generationRule ?? "");
}

type Refund = { penalty: number; stake: number; fees: number };
export function refundTotal(refund: Refund) {
  return refund.penalty + refund.stake + refund.fees;
}

export async function approveQuizCorrection(reportId: string, input?: string, ruleInput?: string) {
  const customText = input === undefined ? undefined : cleanCorrection(input);
  if (customText !== undefined && (!customText || customText.length > CORRECTION_TEXT_MAX)) return { status: "invalid" as const };
  const customRule = cleanGenerationRule(ruleInput ?? "");
  if (ruleInput?.trim() && !customRule) return { status: "invalid-rule" as const };
  return walletTransaction(async tx => {
    const report = await tx.quizReport.findUnique({ where: { id: reportId } });
    const analysis = report && correctionAnalysis(report);
    if (!report || !analysis) return { status: "unavailable" as const };
    const text = customText ?? suggestedCorrection(analysis);
    if (!text) return { status: "unavailable" as const };
    const generationRule = input === undefined ? suggestedGenerationRule(analysis) : customRule;
    const identity = { messageId: report.messageId, guildId: report.guildId, channelId: report.channelId };
    const quiz = await tx.quizSettlement.findUnique({ where: identity, select: { scoredAt: true, correction: true } });
    if (!quiz) return { status: "unavailable" as const };
    if (quiz.correction) return { status: "already" as const, correction: quiz.correction };
    if (!quiz.scoredAt) return { status: "pending" as const };

    const { messageId, guildId } = identity;
    const [answers, wagers, charges] = await Promise.all([
      tx.quizAnswer.findMany({ where: { messageId, guildId },
        select: { userId: true, correct: true, sparksPenalty: true } }),
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
    for (const wager of wagers) {
      const remainingStake = wager.amount - (wager.payout ?? wager.amount);
      if (remainingStake > 0) forUser(wager.userId).stake = remainingStake;
    }
    for (const charge of charges) forUser(charge.userId).fees = charge.fees;
    for (const answer of answers) {
      if (answer.correct) refunds.delete(answer.userId);
      else if (answer.sparksPenalty > 0) forUser(answer.userId).penalty = answer.sparksPenalty;
    }
    const players = [...refunds.keys()].sort();
    const wallets = players.length ? await tx.userScore.findMany({ where: { guildId, userId: { in: players } },
      select: { userId: true, sparks: true } }) : [];
    const balances = new Map(wallets.map(wallet => [wallet.userId, wallet.sparks]));
    if (players.some(userId => (balances.get(userId) ?? 0) + refundTotal(refunds.get(userId)!) > maxWalletValue)) {
      return { status: "balance-limit" as const };
    }
    const refundedSparks = [...refunds.values()].reduce((total, refund) => total + BigInt(refundTotal(refund)), 0n);
    const correction = await tx.quizCorrection.create({ data: { messageId, reportId, text, refundedSparks, refundedPlayers: players.length } });
    if (generationRule) {
      const key = generationRuleKey(generationRule);
      await tx.quizGenerationRule.upsert({ where: { key }, create: { key, text: generationRule }, update: {} });
    }
    const streakPlayers = answers.filter(answer => !answer.correct).map(answer => answer.userId);
    const protectedHistory = new Map<string, { correct: boolean; streakProtected: boolean }[]>();
    if (streakPlayers.length) {
      await tx.quizAnswer.updateMany({ where: { messageId, guildId, correct: false }, data: { streakProtected: true } });
      const history = await tx.quizAnswer.findMany({ where: { guildId, userId: { in: streakPlayers } },
        select: { userId: true, correct: true, streakProtected: true },
        orderBy: [{ finishedAt: "asc" }, { messageId: "asc" }] });
      for (const answer of history) {
        if (!protectedHistory.has(answer.userId)) protectedHistory.set(answer.userId, []);
        protectedHistory.get(answer.userId)!.push(answer);
      }
    }
    for (const userId of [...new Set([...players, ...streakPlayers])].sort()) {
      const refund = refunds.get(userId);
      const amount = refund ? refundTotal(refund) : 0;
      const history = protectedHistory.get(userId);
      const score = history && scoreHistory(history);
      await tx.userScore.upsert({ where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, sparks: amount, ...score },
        update: { ...(amount ? { sparks: { increment: amount } } : {}),
          ...(score ? { currentStreak: score.currentStreak, bestStreak: score.bestStreak } : {}) } });
    }
    if (players.length) await tx.quizRefund.createMany({ data: players.map(userId => ({ messageId, userId, ...refunds.get(userId)! })) });
    return { status: "approved" as const, correction, generationRule };
  });
}
