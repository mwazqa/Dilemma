import type { GuildSettings } from "@prisma/client";
import { db } from "../db.js";
import { normalizeLanguage } from "../languages.js";

const maxEntries = 10_000;
const lifetimeMs = 60 * 60 * 1_000;
const cache = new Map<string, { value: Promise<GuildSettings | null>; expiresAt: number }>();

function put(guildId: string, value: Promise<GuildSettings | null>) {
  cache.delete(guildId);
  cache.set(guildId, { value, expiresAt: Date.now() + lifetimeMs });
  if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
}

export function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const stored = cache.get(guildId);
  if (stored && stored.expiresAt > Date.now()) return stored.value;
  const value = db.guildSettings.findUnique({ where: { guildId } })
    .then(settings => settings ? { ...settings, language: normalizeLanguage(settings.language) } : null);
  put(guildId, value);
  void value.catch(() => {
    if (cache.get(guildId)?.value === value) cache.delete(guildId);
  });
  return value;
}

export function cacheGuildSettings(settings: GuildSettings): GuildSettings {
  const normalized = { ...settings, language: normalizeLanguage(settings.language) };
  put(normalized.guildId, Promise.resolve(normalized));
  return normalized;
}

export async function ensureGuildSettings(guildId: string): Promise<GuildSettings> {
  return await getGuildSettings(guildId) ?? cacheGuildSettings(await db.guildSettings.upsert({
    where: { guildId }, create: { guildId }, update: {}
  }));
}

export function clearGuildSettingsCache(guildId?: string) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}
