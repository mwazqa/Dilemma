import { readFileSync } from "node:fs";
import { message, normalizeLanguage } from "./messages.js";

export const runningVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const playerRelease = {
  version: "3.10.1",
  changes: {
    en: [
      "New quiz cards use the shorter label Wrong for the Sparks penalty and show it beside the quiz duration in the top-right corner.",
      "The Report quiz button is now red, making it easier to find during a quiz and after it closes."
    ],
    pl: [
      "Na nowych grafikach quizów kara ma krótszy podpis Błąd i znajduje się obok czasu trwania, w prawym górnym rogu.",
      "Przycisk Zgłoś quiz jest teraz czerwony, żeby łatwiej było go znaleźć podczas quizu i po jego zakończeniu."
    ]
  }
} as const;

export function getReleaseNoticePayload(language: string) {
  if (runningVersion !== playerRelease.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runningVersion)) throw Error("Player release notes need review");
  const changes = playerRelease.changes[normalizeLanguage(language)];
  const content = message(language, "releaseUpdateHeading", { version: runningVersion }) + "\n\n" + changes.map(change => `- ${change}`).join("\n");
  if (content.length > 2000 || !changes.length) throw Error("Player release notes exceed the message budget");
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
