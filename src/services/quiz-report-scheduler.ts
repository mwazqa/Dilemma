import { Routes, type Client } from "discord.js";
import { env } from "../config.js";
import { db } from "../db.js";
import { message } from "../messages.js";
import { inlineText, textPages } from "../formatting.js";
import { privateErrorSummary } from "../private-errors.js";
import { DeadlineQueue, retryDelay } from "./deadline-queue.js";
import { quizDayBounds } from "./quiz-limits.js";
import { analyzeQuizReports, reportAnalysisSchema } from "./quiz-report-analysis.js";
import { deliverQuizReportReview, safeReportText } from "./quiz-report-review.js";

export const REPORT_REVIEW_TIMEZONE = "Europe/Warsaw";
type BatchRunner = (client: Client, cutoff: Date, current: () => boolean) => Promise<boolean>;

export async function processQuizReportBatch(client: Client, cutoff: Date, current = () => true,
  analyze = analyzeQuizReports) {
  if (!env.QUIZ_REPORT_RECIPIENT_ID) return false;
  const reports = await db.quizReport.findMany({ where: { reviewedAt: null, createdAt: { lte: cutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20,
    select: { id: true, guildId: true, channelId: true, messageId: true, question: true, options: true, correctOption: true,
      explanation: true, reason: true, analysis: true } });
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = report.messageId + ":" + (report.analysis ?? "");
    const group = groups.get(key) ?? []; group.push(report); groups.set(key, group);
  }
  const language = env.QUIZ_REPORT_REVIEW_LANGUAGE;
  for (const group of [...groups.values()].slice(0, 4)) {
    if (!current()) return false;
    const first = group[0];
    let cached;
    try { cached = first.analysis ? reportAnalysisSchema.safeParse(JSON.parse(first.analysis)) : null; } catch { cached = null; }
    const analysis = cached?.success ? cached.data : await analyze(group);
    if (!current()) return false;
    const note = JSON.stringify(analysis);
    await db.quizReport.updateMany({ where: { id: { in: group.map(report => report.id) }, reviewedAt: null },
      data: { analysis: note, analyzedAt: new Date() } });
    const verdict = analysis.verdict === "confirmed" ? "quizReportReviewConfirmed"
      : analysis.verdict === "not-confirmed" ? "quizReportReviewNotConfirmed" : "quizReportReviewUncertain";
    const url = [first.guildId, first.channelId, first.messageId].every(id => /^\d{17,20}$/.test(id))
      ? `https://discord.com/channels/${first.guildId}/${first.channelId}/${first.messageId}` : "";
    const blocks = [`**${inlineText(safeReportText(first.question))}**`, url,
      `**${message(language, "quizReportReviewReasons")}:**\n` + [...new Set(group.map(report => {
        const reason = safeReportText(report.reason);
        return inlineText(reason.length > 350 ? reason.slice(0, 350) + "..." : reason);
      }))].join("\n"),
      `**${message(language, verdict)}**`, `**${message(language, "quizReportReviewFinding")}:** ${safeReportText(analysis.finding)}`,
      `**${message(language, "quizReportReviewSuggestion")}:** ${safeReportText(analysis.suggestion)}`,
      analysis.sources.length ? `**${message(language, "quizReportReviewSources")}:**\n` + analysis.sources.map(source =>
        `[${inlineText(source.title)}](${source.url.replace(/[()]/g, character => encodeURIComponent(character))})`).join("\n")
        : message(language, "quizReportReviewNoSources")];
    let channel: { id: string } | undefined;
    const result = await deliverQuizReportReview(db, { recipientId: env.QUIZ_REPORT_RECIPIENT_ID,
      reviews: group.map(report => ({ id: report.id,
        note: [`${message(language, "quizReportReviewFinding")}: ${analysis.finding}`,
          `${message(language, "quizReportReviewSuggestion")}: ${analysis.suggestion}`,
          ...analysis.sources.map(source => source.url)].join("\n").slice(0, 3000) })),
      messages: textPages(blocks, 1900) }, async body => {
      if (!current()) throw Error("Report review stopped");
      channel ??= await client.rest.post(Routes.userChannels(), { body: { recipient_id: env.QUIZ_REPORT_RECIPIENT_ID } }) as { id: string };
      return client.rest.post(Routes.channelMessages(channel.id), { body, signal: AbortSignal.timeout(15000) });
    }, message(language, "quizReportReviewIntro", { count: group.length }));
    if (result.status !== "delivered" && result.status !== "already-delivered") throw Error("Report review delivery pending");
  }
  return reports.length === 20 || groups.size > 4;
}

export function startQuizReportReviewScheduler(client: Client, runBatch: BatchRunner = processQuizReportBatch) {
  if (!env.QUIZ_REPORT_RECIPIENT_ID) return () => {};
  console.log("Quiz report review scheduler started");
  let attempt = 0;
  const queue = new DeadlineQueue(async (_, current) => {
    try {
      const { start, end } = quizDayBounds(new Date(), REPORT_REVIEW_TIMEZONE);
      const more = await runBatch(client, start, current);
      if (!current()) return;
      attempt = 0;
      queue.schedule("reports", more ? Date.now() + 1000 : end);
    } catch (error) {
      if (!current()) return;
      queue.schedule("reports", Date.now() + retryDelay(attempt++, 60000));
      console.warn("Quiz report review pending:", privateErrorSummary(error));
    }
  }, error => console.error("Quiz report review failed:", privateErrorSummary(error)));
  queue.schedule("reports", Date.now());
  return () => queue.stop();
}
