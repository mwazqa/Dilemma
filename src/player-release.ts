import { readFileSync } from "node:fs";
import { message, normalizeLanguage } from "./messages.js";

export const runningVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export type PlayerReleaseHighlights = { version: string; changes: { en: readonly string[]; pl: readonly string[] } };

export const playerRelease: PlayerReleaseHighlights = {
  version: "3.13.2",
  changes: {
    en: [
      "Dilemma command descriptions and input fields are now available in Polish."
    ],
    pl: [
      "Opisy komend Dilemmy i ich pól są teraz dostępne po polsku."
    ]
  }
};

export function getReleaseNoticePayload(language: string, release = playerRelease) {
  if (runningVersion !== release.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runningVersion)) throw Error("Player release notes need review");
  if (Boolean(release.changes.en.length) !== Boolean(release.changes.pl.length)) throw Error("Player release highlights need both languages");
  if (Object.values(release.changes).some(list => list.some(change => !change.trim()))) throw Error("Player release highlights cannot be blank");
  const changes = release.changes[normalizeLanguage(language)];
  if (!changes.length) return null;
  const content = message(language, "releaseUpdateHeading", { version: runningVersion }) + "\n\n" + changes.map(change => `- ${change}`).join("\n");
  if (content.length > 2000) throw Error("Player release notes exceed the message budget");
  return { content, allowed_mentions: { parse: [] } };
}

let published: { checkedAt: number; ready: boolean } | undefined;
export async function isCurrentReleasePublished() {
  if (published && (published.ready || Date.now() - published.checkedAt < 120000)) return published.ready;
  const response = await fetch(`https://api.github.com/repos/mwazqa/Dilemma/releases/tags/v${runningVersion}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "Dilemma-release-notices" }, signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) { published = { checkedAt: Date.now(), ready: false }; return false; }
  if (!response.ok) throw Error("Release publication check unavailable");
  const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean };
  const ready = release.tag_name === `v${runningVersion}` && release.draft === false;
  published = { checkedAt: Date.now(), ready };
  return ready;
}
