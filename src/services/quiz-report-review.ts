import type { PrismaClient } from "@prisma/client";
import type { APIActionRowComponent, APIButtonComponent } from "discord.js";

type ReviewDatabase = Pick<PrismaClient, "quizReport" | "$transaction">;
export type ReportReviewNote = { id: string; note: string };
type ReviewControls = APIActionRowComponent<APIButtonComponent>[];
export type ReviewDelivery = { recipientId: string; reviews: ReportReviewNote[]; messages: string[]; components?: ReviewControls };
export type ReviewSender = (body: { content: string; nonce: string; enforce_nonce: true; allowed_mentions: { parse: [] };
  components?: ReviewControls }) => Promise<unknown>;

export function safeReportText(value: unknown) {
  return String(value).replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted key]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/\S+/gi, "[redacted connection]")
    .replace(/\b(?:sk-|ghp_|github_pat_|napi_)[A-Za-z0-9_-]{16,}/g, "[redacted key]")
    .replace(/\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,8}\.[A-Za-z0-9_-]{27,}\b/g, "[redacted token]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted key]")
    .replace(/\b(?:password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*["']?[^\s"',;]+/gi, "[redacted credential]")
    .replace(/https?:\/\/[^\s/:]+:[^\s/@]+@[^\s]+/gi, "[redacted authenticated URL]")
    .replace(/(?:authorization\s*[:=]\s*|\bbearer\s+)[^\s,;]+/gi, "[redacted authorization]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/<@!?\d+>|<@&\d+>/g, "[redacted mention]");
}

export async function reviewQuizReports(db: ReviewDatabase, input: { action: string; reviews?: ReportReviewNote[] }) {
  if (!db.quizReport) return { status: "not-deployed" };
  if (input.action === "pending") {
    const rows = await db.quizReport.findMany({ where: { reviewedAt: null }, take: 101,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, guildId: true, channelId: true, messageId: true, reason: true, source: true, question: true,
        options: true, correctOption: true, explanation: true, difficulty: true, createdAt: true, quizCreatedAt: true } });
    return { status: "ready", hasMore: rows.length > 100, reports: rows.slice(0, 100).map(row => ({
      id: row.id, reportedAt: row.createdAt, quizCreatedAt: row.quizCreatedAt, source: row.source, difficulty: row.difficulty,
      question: safeReportText(row.question), options: safeReportText(row.options), correctOption: row.correctOption,
      explanation: safeReportText(row.explanation), reason: safeReportText(row.reason),
      url: [row.guildId, row.channelId, row.messageId].every(id => /^\d{17,20}$/.test(id))
        ? `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}` : undefined
    })) };
  }
  if (input.action !== "ack" || !Array.isArray(input.reviews) || input.reviews.length < 1 || input.reviews.length > 100 ||
    new Set(input.reviews.map(item => item.id)).size !== input.reviews.length || input.reviews.some(item =>
      !/^[a-z0-9]{20,32}$/.test(item.id) || typeof item.note !== "string" || item.note.trim().length < 10 || item.note.length > 3000)) {
    return { status: "invalid" };
  }
  const reviewedAt = new Date();
  const results = await db.$transaction(input.reviews.map(item => db.quizReport.updateMany({
    where: { id: item.id, reviewedAt: null }, data: { reviewedAt, reviewNote: safeReportText(item.note.trim()) }
  })));
  return { status: "acknowledged", reviewed: results.reduce((sum, result) => sum + result.count, 0) };
}

export async function deliverQuizReportReview(db: ReviewDatabase, input: ReviewDelivery, send: ReviewSender, intro: string) {
  const reviews = input.reviews;
  if (!/^\d{17,20}$/.test(input.recipientId ?? "") || !Array.isArray(reviews) || !reviews.length || reviews.length > 100 ||
    new Set(reviews.map(item => item.id)).size !== reviews.length || reviews.some(item => !/^[a-z0-9]{20,32}$/.test(item.id) ||
      typeof item.note !== "string" || item.note.trim().length < 10 || item.note.length > 3000) ||
    !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 20 ||
    input.messages.some(text => typeof text !== "string" || !text.trim() || text.length > 1900) ||
    typeof intro !== "string" || intro.length > 1900) return { status: "invalid" };
  const { createHash } = await import("node:crypto");
  const batch = createHash("sha256").update(input.recipientId + ":" + reviews.map(item => item.id).sort().join(",")).digest("hex");
  return db.$transaction(async tx => {
    const rows = await tx.quizReport.findMany({ where: { id: { in: reviews.map(item => item.id) } }, select: { id: true, reviewedAt: true } });
    if (rows.length !== reviews.length) return { status: "invalid" };
    if (rows.every(row => row.reviewedAt)) return { status: "already-delivered" };
    if (rows.some(row => row.reviewedAt)) return { status: "conflict" };
    const claimed = await tx.quizReport.updateMany({ where: { id: { in: reviews.map(item => item.id) }, reviewedAt: null },
      data: { reviewNote: "Private review delivery in progress" } });
    if (claimed.count !== reviews.length) throw Error("review-conflict");
    const pages = [intro, ...input.messages].map(safeReportText);
    for (const [index, content] of pages.entries()) {
      const nonce = createHash("sha256").update(batch + ":" + index).digest("hex").slice(0, 25);
      await send({ content, nonce, enforce_nonce: true, allowed_mentions: { parse: [] },
        ...(index === pages.length - 1 && input.components ? { components: input.components } : {}) });
    }
    const reviewedAt = new Date();
    for (const item of reviews) await tx.quizReport.updateMany({ where: { id: item.id, reviewedAt: null },
      data: { reviewedAt, reviewNote: safeReportText(item.note.trim()) } });
    return { status: "delivered", reviewed: reviews.length, messages: pages.length };
  }, { isolationLevel: "Serializable", timeout: 60000, maxWait: 5000 });
}
