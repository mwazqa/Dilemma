import { env } from "../config.js";

export function parseTimezone(value: string): string | null {
  const name = value.trim();
  if (!name.includes("/") && name.toUpperCase() !== "UTC") return null;
  try { return new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone; }
  catch { return null; }
}

export function guildTimezone(settings?: { timezone?: string | null } | null): string {
  return settings?.timezone ? parseTimezone(settings.timezone) ?? env.QUIZ_TIMEZONE : env.QUIZ_TIMEZONE;
}

const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function timezoneSuggestions(query: string) {
  const search = query.trim().toLowerCase().replace(/ /g, "_");
  return zones.filter(zone => zone.toLowerCase().includes(search)).slice(0, 25)
    .map(zone => ({ name: zone, value: zone }));
}
