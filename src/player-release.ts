import { readFileSync } from "node:fs";
import { message, normalizeLanguage } from "./messages.js";

export const runningVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const playerRelease = {
  version: "3.10.0",
  changes: {
    en: [
      "The player guide is now a general introduction to quizzes. Check current fees and penalties in the quiz interface.",
      "The guide no longer has a Refresh button. I'll post release news as separate messages on channels where the guide was published.",
      "Existing guides will be converted once, and each channel receives one announcement per release.",
      "Quiz reports sent privately to Dilemma's owner now include the reporter's account and full description. The report form explains this before you submit."
    ],
    pl: [
      "Poradnik jest teraz ogólnym wprowadzeniem do quizów. Aktualne opłaty i kary sprawdzisz w interfejsie quizu.",
      "Usunęłam z poradnika przycisk Odśwież. Nowości z wydań będę publikować osobnymi wiadomościami na kanałach z poradnikiem.",
      "Dotychczasowe poradniki zamienię jednorazowo na nową wersję. Na każdy kanał trafi jedno ogłoszenie danego wydania.",
      "Prywatne podsumowanie zgłoszeń dla właściciela Dilemmy zawiera teraz konto zgłaszającego i pełny opis. Informację o tym znajdziesz w formularzu przed wysłaniem."
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
