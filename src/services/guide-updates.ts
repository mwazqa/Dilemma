import { ChannelType, MessageFlags, PermissionFlagsBits, Routes, type Client } from "discord.js";
import { db } from "../db.js";
import { normalizeLanguage } from "../messages.js";
import { isCurrentReleasePublished } from "../player-release.js";
import { privateErrorSummary } from "../private-errors.js";
import { getGuildSettings } from "./guild-settings.js";
import { getPlayerGuideContentHash, getPlayerGuidePayload, getPlayerGuideText, LEGACY_GUIDE_REFRESH_BUTTON_ID } from "./player-guide.js";
import { registerGuidePublication, publishGuideReleaseNotice } from "./guide-publications.js";
import { DeadlineQueue, retryDelay } from "./deadline-queue.js";
import { scheduleEvents } from "./schedule-events.js";

type HistoryComponent = { type: number; custom_id?: string; components?: HistoryComponent[] };
type HistoryMessage = { id: string; channel_id: string; author: { id: string }; flags?: number;
  components?: HistoryComponent[]; embeds?: { description?: string }[] };
function ownedPublicMessage(message: HistoryMessage, botId: string, channelId: string) {
  return message.author?.id === botId && message.channel_id === channelId && !((message.flags ?? 0) & MessageFlags.Ephemeral);
}
function hasLegacyGuideButton(message: HistoryMessage) {
  return message.components?.some(row => row.type === 1 && row.components?.some(button => button.type === 2 && button.custom_id === LEGACY_GUIDE_REFRESH_BUTTON_ID)) ?? false;
}
function hasGuideText(source: HistoryMessage, language: string) {
  return !source.components?.length && source.embeds?.length === 1 && source.embeds[0].description === getPlayerGuideText(language);
}
function missingGuide(error: unknown) {
  return error && typeof error === "object" && "code" in error && (error.code === 10003 || error.code === 10008);
}
async function editGuide(client: Client, channelId: string, messageId: string, language: string) {
  const { embeds, components, allowedMentions } = getPlayerGuidePayload(language);
  await client.rest.patch(Routes.channelMessage(channelId, messageId), {
    body: { content: null, embeds: embeds.map(embed => embed.toJSON()), components, allowed_mentions: allowedMentions },
    signal: AbortSignal.timeout(10000)
  });
}

export async function discoverGuidePage(client: Client, channelId: string) {
  const key = { channelId, kind: "messages" };
  const cursor = await db.guideDiscovery.findUnique({ where: { channelId_kind: key } });
  if (!cursor || cursor.completedAt) return { more: false, found: [] as string[] };
  const query = new URLSearchParams({ limit: "100", ...(cursor.cursor ? { before: cursor.cursor } : {}) });
  const messages = await client.rest.get(Routes.channelMessages(channelId), { query, signal: AbortSignal.timeout(10000) }) as HistoryMessage[];
  if (!Array.isArray(messages) || messages.some(message => !/^\d{17,20}$/.test(message.id))) throw Error("Invalid guide history page");
  const last = messages.at(-1)?.id;
  if (last && cursor.cursor && BigInt(last) >= BigInt(cursor.cursor)) throw Error("Guide history cursor did not advance");
  const found: string[] = [];
  for (const source of messages) {
    if (!ownedPublicMessage(source, client.user!.id, channelId) || !hasLegacyGuideButton(source)) continue;
    await registerGuidePublication({ messageId: source.id, guildId: cursor.guildId, channelId }, true, false);
    found.push(source.id);
  }
  const more = messages.length === 100;
  await db.guideDiscovery.update({ where: { channelId_kind: key }, data: {
    ...(last ? { cursor: last } : {}), ...(more ? {} : { completedAt: new Date() })
  } });
  return { more, found };
}

export async function discoverArchivedGuideThreads(client: Client, channelId: string, kind: string) {
  if (!["public", "private", "joined"].includes(kind)) throw Error("Invalid guide discovery kind");
  const key = { channelId, kind };
  const cursor = await db.guideDiscovery.findUnique({ where: { channelId_kind: key } });
  if (!cursor || cursor.completedAt) return { more: false, found: [] as string[] };
  const route = kind === "joined" ? Routes.channelJoinedArchivedThreads(channelId) : Routes.channelThreads(channelId, kind as "public" | "private");
  const query = new URLSearchParams({ limit: "100", ...(cursor.cursor ? { before: cursor.cursor } : {}) });
  const page = await client.rest.get(route, { query, signal: AbortSignal.timeout(10000) }) as {
    threads: { id: string; guild_id?: string; parent_id: string; thread_metadata: { archive_timestamp: string } }[]; has_more: boolean
  };
  if (!Array.isArray(page.threads) || typeof page.has_more !== "boolean") throw Error("Invalid archived guide page");
  const found: string[] = [];
  for (const thread of page.threads) {
    if ((thread.guild_id && thread.guild_id !== cursor.guildId) || thread.parent_id !== channelId || !/^\d{17,20}$/.test(thread.id)) throw Error("Invalid archived guide identity");
    const stored = await db.guideDiscovery.upsert({ where: { channelId_kind: { channelId: thread.id, kind: "messages" } },
      create: { channelId: thread.id, kind: "messages", guildId: cursor.guildId }, update: {} });
    if (!stored.completedAt) found.push(thread.id);
  }
  const last = page.threads.at(-1);
  const next = last ? kind === "joined" ? last.id : last.thread_metadata.archive_timestamp : null;
  if (page.has_more && (!next || next === cursor.cursor)) throw Error("Archived guide cursor did not advance");
  await db.guideDiscovery.update({ where: { channelId_kind: key }, data: {
    ...(next ? { cursor: next } : {}), ...(page.has_more ? {} : { completedAt: new Date() })
  } });
  return { more: page.has_more, found };
}

export async function migrateLegacyGuide(client: Client, messageId: string) {
  const publication = await db.guidePublication.findUnique({ where: { messageId } });
  if (!publication || !publication.active || publication.genericAt) return;
  let source: HistoryMessage;
  try {
    source = await client.rest.get(Routes.channelMessage(publication.channelId, messageId), { signal: AbortSignal.timeout(10000) }) as HistoryMessage;
  } catch (error) {
    if (missingGuide(error)) {
      await db.guidePublication.update({ where: { messageId }, data: { active: false } }); return;
    }
    throw error;
  }
  const storedLanguage = ["en", "pl"].find(language => hasGuideText(source, language));
  if (source.id !== messageId || !ownedPublicMessage(source, client.user!.id, publication.channelId) ||
    (!hasLegacyGuideButton(source) && !storedLanguage)) {
    await db.guidePublication.update({ where: { messageId }, data: { active: false } }); return;
  }
  const language = normalizeLanguage((await getGuildSettings(publication.guildId))?.language ?? "en");
  if (storedLanguage !== language) await editGuide(client, publication.channelId, messageId, language);
  await registerGuidePublication(publication, true, true, getPlayerGuideContentHash(language));
}

export async function updatePublishedGuide(client: Client, messageId: string, isPublished = isCurrentReleasePublished, current = () => true) {
  const publication = await db.guidePublication.findUnique({ where: { messageId } });
  if (!publication?.active || !publication.genericAt) return "unavailable";
  const { guildId, channelId } = publication;
  const language = normalizeLanguage((await getGuildSettings(guildId))?.language ?? "en");
  const contentHash = getPlayerGuideContentHash(language);
  if (publication.contentHash === contentHash) return "done";
  if (!current()) return "stopped";
  if (!await isPublished()) return "unpublished";
  if (!current()) return "stopped";
  try {
    const source = await client.rest.get(Routes.channelMessage(channelId, messageId), { signal: AbortSignal.timeout(10000) }) as HistoryMessage;
    if (!current()) return "stopped";
    if (source.id === messageId && ownedPublicMessage(source, client.user!.id, channelId)) {
      if (!hasGuideText(source, language)) await editGuide(client, channelId, messageId, language);
      await db.guidePublication.update({ where: { messageId }, data: { contentHash } });
      return "done";
    }
  } catch (error) {
    if (!missingGuide(error)) throw error;
  }
  await db.guidePublication.update({ where: { messageId }, data: { active: false } });
  return "unavailable";
}

export function startGuideUpdatesScheduler(client: Client) {
  const attempts = new Map<string, number>();
  const noticeChannels = new Map<string, { guildId: string; channelId: string }>();
  const notice = (guildId: string, channelId: string) => {
    const key = `notice:${channelId}`; noticeChannels.set(key, { guildId, channelId }); queue.schedule(key, Date.now());
  };
  const queue = new DeadlineQueue(async (key, current) => {
    try {
      if (key === "bootstrap") {
        const guildIds = [...client.guilds.cache.keys()];
        const known = await db.guidePublication.findMany({ where: { active: true, guildId: { in: guildIds } },
          select: { guildId: true, channelId: true, messageId: true, genericAt: true } });
        for (const publication of known) {
          if (!current()) return;
          if (!publication.genericAt) queue.schedule(`migrate:${publication.messageId}`, Date.now());
          else {
            queue.schedule(`update:${publication.messageId}`, Date.now());
            notice(publication.guildId, publication.channelId);
          }
        }
        for (const guild of client.guilds.cache.values()) {
          if (!current()) return;
          const channels = await guild.channels.fetch();
          const threads = await guild.channels.fetchActiveThreads();
          const member = guild.members.me ?? await guild.members.fetchMe();
          for (const channel of [...channels.values(), ...threads.threads.values()]) {
            if (!current()) return;
            if (!channel || channel.guildId !== guild.id ||
              !channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
            const kinds = channel.isTextBased() && channel.isSendable() ? ["messages"] : [];
            if ("threads" in channel) kinds.push("public");
            if (channel.type === ChannelType.GuildText) {
              kinds.push("joined");
              if (channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads)) kinds.push("private");
            }
            for (const kind of kinds) await db.guideDiscovery.upsert({ where: { channelId_kind: { channelId: channel.id, kind } },
              create: { channelId: channel.id, kind, guildId: guild.id }, update: {} });
          }
        }
        const pending = await db.guideDiscovery.findMany({ where: { completedAt: null, guildId: { in: guildIds } }, select: { channelId: true, kind: true } });
        for (const cursor of pending) if (current()) queue.schedule(cursor.kind === "messages" ? `scan:${cursor.channelId}` : `archives:${cursor.kind}:${cursor.channelId}`, Date.now());
      } else if (key.startsWith("archives:")) {
        const [, kind, channelId] = key.split(":");
        const page = await discoverArchivedGuideThreads(client, channelId, kind);
        if (!current()) return;
        for (const id of page.found) queue.schedule(`scan:${id}`, Date.now());
        if (page.more) queue.schedule(key, Date.now() + 1000);
      } else if (key.startsWith("scan:")) {
        const channelId = key.slice(5);
        const page = await discoverGuidePage(client, channelId);
        if (!current()) return;
        for (const messageId of page.found) queue.schedule(`migrate:${messageId}`, Date.now());
        if (page.more) queue.schedule(key, Date.now() + 1000);
      } else if (key.startsWith("migrate:")) {
        await migrateLegacyGuide(client, key.slice(8));
      } else if (key.startsWith("update:")) {
        const result = await updatePublishedGuide(client, key.slice(7), undefined, current);
        if (result === "unpublished" && current()) queue.schedule(key, Date.now() + 120000);
      } else {
        const target = noticeChannels.get(key);
        if (!target) return;
        const result = await publishGuideReleaseNotice(client, target.guildId, target.channelId, undefined, current);
        if (result === "unpublished" && current()) queue.schedule(key, Date.now() + 120000);
      }
      attempts.delete(key);
    } catch (error) {
      if (!current()) return;
      const attempt = attempts.get(key) ?? 0; attempts.set(key, attempt + 1);
      queue.schedule(key, Date.now() + retryDelay(attempt));
      console.warn("Guide release update pending:", privateErrorSummary(error));
    }
  }, error => console.error("Guide release update failed:", privateErrorSummary(error)));
  scheduleEvents.on("guidePublished", notice);
  queue.schedule("bootstrap", Date.now());
  console.log("Guide release updates scheduler started");
  return () => { queue.stop(); scheduleEvents.off("guidePublished", notice); };
}
