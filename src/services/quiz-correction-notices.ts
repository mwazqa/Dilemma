import { createHash } from "node:crypto";
import { ActionRowBuilder, MessageFlags, Routes, type ButtonBuilder, type Client } from "discord.js";
import { db } from "../db.js";
import { message } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";
import { DeadlineQueue, retryDelay } from "./deadline-queue.js";
import { getGuildSettings } from "./guild-settings.js";
import { quizJumpButton } from "./poll-controls.js";
import { scheduleEvents } from "./schedule-events.js";

export async function publishQuizCorrection(client: Client, messageId: string, current = () => true) {
  const correction = await db.quizCorrection.findUnique({ where: { messageId }, include: {
    settlement: { select: { messageId: true, guildId: true, channelId: true } }
  } });
  if (!correction || correction.publishedAt || !current()) return false;
  const quiz = correction.settlement;
  const language = (await getGuildSettings(quiz.guildId))?.language ?? "en";
  const refund = correction.refundedPlayers
    ? message(language, "quizCorrectionPublicRefund", { sparks: correction.refundedSparks.toString() })
    : message(language, "quizCorrectionPublicNoRefund");
  const content = [message(language, "quizCorrectionPublicHeading"), correction.text, refund].join("\n\n");
  const nonce = createHash("sha256").update(`quiz-correction:${messageId}`).digest("hex").slice(0, 25);
  return db.$transaction(async tx => {
    if (!current()) return false;
    const claim = await tx.quizCorrection.updateMany({ where: { messageId, publishedAt: null }, data: { publishedAt: new Date() } });
    if (!claim.count) return false;
    await client.rest.post(Routes.channelMessages(quiz.channelId), {
      body: { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(quizJumpButton(language, quiz)).toJSON()],
        allowed_mentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds, nonce, enforce_nonce: true },
      signal: AbortSignal.timeout(10_000)
    });
    return true;
  }, { timeout: 15_000 });
}

export function startQuizCorrectionScheduler(client: Client) {
  const attempts = new Map<string, number>();
  const schedule = (messageId: string) => queue.schedule(messageId, Date.now());
  const queue = new DeadlineQueue(async (key, current) => {
    try {
      if (key === "bootstrap") {
        const pending = await db.quizCorrection.findMany({ where: { publishedAt: null }, select: { messageId: true } });
        if (current()) for (const correction of pending) schedule(correction.messageId);
      } else await publishQuizCorrection(client, key, current);
      attempts.delete(key);
    } catch (error) {
      if (!current()) return;
      const attempt = attempts.get(key) ?? 0;
      attempts.set(key, attempt + 1);
      queue.schedule(key, Date.now() + retryDelay(attempt));
      console.warn("Quiz correction notice pending:", privateErrorSummary(error));
    }
  }, error => console.error("Quiz correction notice failed:", privateErrorSummary(error)));
  scheduleEvents.on("quizCorrectionApproved", schedule);
  schedule("bootstrap");
  return () => { queue.stop(); scheduleEvents.off("quizCorrectionApproved", schedule); };
}
