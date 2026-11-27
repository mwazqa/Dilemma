import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, Routes, type Client } from "discord.js";
import { env } from "../config.js";
import { db } from "../db.js";
import { message } from "../messages.js";
import { inlineText, textPages } from "../formatting.js";
import { privateErrorSummary } from "../private-errors.js";
import { DeadlineQueue, retryDelay } from "./deadline-queue.js";
import { quizDayBounds } from "./quiz-limits.js";
import { analyzeQuizReports, reportAnalysisCacheSchema, reportAnalysisSchema, reportAnalysisScopeKey, type ReportAnalysis } from "./quiz-report-analysis.js";
import { deliverQuizReportReview, safeReportText } from "./quiz-report-review.js";
import { CORRECTION_ACCEPT_PREFIX, CORRECTION_BUTTON_PREFIX, suggestedCorrection, suggestedGenerationRule } from "./quiz-corrections.js";

export const REPORT_REVIEW_TIMEZONE = "Europe/Warsaw";
type BatchRunner = (client: Client, cutoff: Date, current: () => boolean) => Promise<boolean>;

export async function processQuizReportBatch(client: Client, cutoff: Date, current = () => true,
  analyze = analyzeQuizReports) {
  if (!env.QUIZ_REPORT_RECIPIENT_ID) return false;
  const reports = await db.quizReport.findMany({ where: { reviewedAt: null, createdAt: { lte: cutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20,
    select: { id: true, guildId: true, channelId: true, messageId: true, reporterUserId: true, question: true, options: true, correctOption: true,
      explanation: true, reason: true, analysis: true } });
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = report.messageId + ":" + reportAnalysisScopeKey(report);
    const group = groups.get(key) ?? []; group.push(report); groups.set(key, group);
  }
  const language = env.QUIZ_REPORT_REVIEW_LANGUAGE;
  const authors = new Map<string, Promise<string>>();
  const reportAuthor = (userId: string) => {
    if (!/^\d{17,20}$/.test(userId)) return Promise.resolve(message(language, "quizReportReviewUnknownAuthor"));
    let author = authors.get(userId);
    if (!author) {
      author = (async () => {
        let name: string | undefined;
        try {
          const cached = client.users.cache.get(userId);
          if (cached) name = cached.username;
          else {
            const user = await client.rest.get(Routes.user(userId), { signal: AbortSignal.timeout(5000) }) as { username?: string };
            name = user.username;
          }
        } catch {}
        const label = name ? inlineText(safeReportText(name).slice(0, 100)) : message(language, "quizReportReviewProfile");
        return `[${label}](https://discord.com/users/${userId}) (\`${userId}\`)`;
      })();
      authors.set(userId, author);
    }
    return author;
  };
  for (const group of [...groups.values()].slice(0, 4)) {
    if (!current()) return false;
    const first = group[0];
    const scopeKey = reportAnalysisScopeKey(first);
    let cached: ReportAnalysis | undefined;
    for (const report of group) {
      try {
        const parsed = report.analysis ? reportAnalysisCacheSchema.safeParse(JSON.parse(report.analysis)) : null;
        if (parsed?.success && parsed.data.scopeKey === scopeKey) { cached = parsed.data.analysis; break; }
      } catch {}
    }
    const analysis = reportAnalysisSchema.parse(cached ?? await analyze(group));
    if (!current()) return false;
    const note = JSON.stringify({ scopeKey, analysis });
    await db.quizReport.updateMany({ where: { id: { in: group.map(report => report.id) }, reviewedAt: null },
      data: { analysis: note, analyzedAt: new Date() } });
    const verdict = analysis.verdict === "confirmed" ? "quizReportReviewConfirmed"
      : analysis.verdict === "not-confirmed" ? "quizReportReviewNotConfirmed" : "quizReportReviewUncertain";
    const proposal = suggestedCorrection(analysis);
    const generationRule = suggestedGenerationRule(analysis);
    const url = [first.guildId, first.channelId, first.messageId].every(id => /^\d{17,20}$/.test(id))
      ? `https://discord.com/channels/${first.guildId}/${first.channelId}/${first.messageId}` : "";
    const findings = [
      `**${message(language, verdict)}**`, `**${message(language, "quizReportReviewFinding")}:** ${safeReportText(analysis.finding)}`,
      `**${message(language, "quizReportReviewSuggestion")}:** ${proposal || safeReportText(analysis.suggestion)}`,
      ...(generationRule ? [`**${message(language, "quizGenerationRuleLabel")}**\n${inlineText(generationRule)}`] : []),
      analysis.sources.length ? `**${message(language, "quizReportReviewSources")}:**\n` + analysis.sources.map(source =>
        `[${inlineText(source.title)}](${source.url.replace(/[()]/g, character => encodeURIComponent(character))})`).join("\n")
        : message(language, analysis.kind === "wording" ? "quizReportReviewTextEvidence" : "quizReportReviewNoSources")];
    let channel: { id: string } | undefined;
    for (let offset = 0; offset < group.length; offset += 5) {
      if (!current()) return false;
      const delivery = group.slice(offset, offset + 5);
      const reportBlocks = [];
      for (const report of delivery) {
        const author = await reportAuthor(report.reporterUserId);
        const reason = safeReportText(report.reason).split(/\r\n|[\r\n\u2028\u2029]/u).map(line => `> ${escapeMarkdown(line)}`).join("\n");
        reportBlocks.push(`**${message(language, "quizReportReviewAuthor")}:** ${author}\n**${message(language, "quizReportReviewReasons")}:**\n${reason}`);
      }
      const actions = new ActionRowBuilder<ButtonBuilder>();
      const reviewId = delivery[0].id;
      if (proposal) actions.addComponents(new ButtonBuilder().setCustomId(`${CORRECTION_ACCEPT_PREFIX}${reviewId}`)
        .setStyle(ButtonStyle.Success).setLabel(message(language, "quizCorrectionAcceptButton")));
      actions.addComponents(new ButtonBuilder().setCustomId(`${CORRECTION_BUTTON_PREFIX}${reviewId}`)
        .setStyle(ButtonStyle.Secondary).setLabel(message(language, proposal ? "quizCorrectionEditButton" : "quizCorrectionWriteButton")));
      const result = await deliverQuizReportReview(db, { recipientId: env.QUIZ_REPORT_RECIPIENT_ID,
        reviews: delivery.map(report => ({ id: report.id,
          note: [`${message(language, "quizReportReviewFinding")}: ${analysis.finding}`,
            `${message(language, "quizReportReviewSuggestion")}: ${analysis.suggestion}`,
            ...analysis.sources.map(source => source.url)].join("\n").slice(0, 3000) })),
        messages: textPages([`**${inlineText(safeReportText(first.question))}**`, url, ...reportBlocks, ...findings], 1900),
        components: [actions.toJSON()] }, async body => {
        if (!current()) throw Error("Report review stopped");
        channel ??= await client.rest.post(Routes.userChannels(), { body: { recipient_id: env.QUIZ_REPORT_RECIPIENT_ID } }) as { id: string };
        return client.rest.post(Routes.channelMessages(channel.id), { body, signal: AbortSignal.timeout(15000) });
      }, message(language, "quizReportReviewIntro", { count: delivery.length }));
      if (result.status !== "delivered" && result.status !== "already-delivered") throw Error("Report review delivery pending");
    }
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
