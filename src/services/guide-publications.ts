import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Routes, type Client } from "discord.js";
import { db } from "../db.js";
import { getReleaseNoticePayload, isCurrentReleasePublished, runningVersion } from "../player-release.js";
import { getGuildSettings } from "./guild-settings.js";
import { normalizeLanguage } from "../messages.js";
import { scheduleEvents } from "./schedule-events.js";

type GuideIdentity = { messageId: string; guildId: string; channelId: string };
export async function registerGuidePublication(identity: GuideIdentity, legacy = false, generic = true) {
  await db.$transaction(async tx => {
    const existing = await tx.guidePublication.findUnique({ where: { messageId: identity.messageId } });
    if (existing && (existing.guildId !== identity.guildId || existing.channelId !== identity.channelId)) throw Error("Guide identity mismatch");
    const record = await tx.guidePublication.upsert({ where: { messageId: identity.messageId }, create: { ...identity, genericAt: generic ? new Date() : null },
      update: { active: true, ...(generic ? { genericAt: new Date() } : {}) } });
    if (record.guildId !== identity.guildId || record.channelId !== identity.channelId) throw Error("Guide identity mismatch");
    if (!legacy) await tx.guideReleaseNotice.upsert({
      where: { guildId_channelId_version: { guildId: identity.guildId, channelId: identity.channelId, version: runningVersion } },
      create: { guildId: identity.guildId, channelId: identity.channelId, version: runningVersion, deliveredAt: new Date() }, update: {}
    });
  });
  if (generic) scheduleEvents.emit("guidePublished", identity.guildId, identity.channelId);
}

export async function publishGuideReleaseNotice(client: Client, guildId: string, channelId: string,
  isPublished = isCurrentReleasePublished, current = () => true) {
  const key = { guildId, channelId, version: runningVersion };
  if ((await db.guideReleaseNotice.findUnique({ where: { guildId_channelId_version: key } }))?.deliveredAt) return "done" as const;
  if (!await db.guidePublication.count({ where: { guildId, channelId, active: true, genericAt: { not: null } } })) return "empty" as const;
  if (!await isPublished()) return "unpublished" as const;
  const language = normalizeLanguage((await getGuildSettings(guildId))?.language ?? "en");
  const payload = getReleaseNoticePayload(language);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.guideReleaseNotice.upsert({ where: { guildId_channelId_version: key }, create: key, update: {} });
        const claim = await tx.guideReleaseNotice.updateMany({ where: { ...key, deliveredAt: null }, data: { version: runningVersion } });
        if (!claim.count) return "done" as const;
        const receipt = await tx.guideReleaseNotice.findUnique({ where: { guildId_channelId_version: key } });
        if (receipt?.deliveredAt) return "done" as const;
        if (!current()) throw Error("Guide update stopped");
        const nonce = createHash("sha256").update(`guide-release:${runningVersion}:${guildId}:${channelId}`).digest("hex").slice(0, 25);
        const sent = await client.rest.post(Routes.channelMessages(channelId), { body: { ...payload, nonce, enforce_nonce: true },
          signal: AbortSignal.timeout(10000) }) as { id: string };
        if (!sent?.id) throw Error("Release announcement could not be confirmed");
        await tx.guideReleaseNotice.update({ where: { guildId_channelId_version: key }, data: { messageId: sent.id, deliveredAt: new Date() } });
        return "sent" as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 10003) {
        await db.guidePublication.updateMany({ where: { guildId, channelId }, data: { active: false } });
        return "empty" as const;
      }
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code) || attempt >= 2) throw error;
    }
  }
}
