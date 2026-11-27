import { readFileSync } from "node:fs";
import { message, normalizeLanguage } from "./messages.js";

export const runningVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export type PlayerReleaseHighlights = { version: string; changes: { en: readonly string[]; pl: readonly string[] } };

export const playerRelease: PlayerReleaseHighlights = {
  version: "3.13.0",
  changes: {
    en: [
      "Your total **EXP** now determines your place on the leaderboard. Your existing progress carries over.",
      "Server managers and Dilemma managers can start a one-off quiz with `/dilemma custom` from a topic or an exact question. Custom and random quizzes have separate limits.",
      "The private vote preview and 50/50 are free, with one use of each per week. New bets range from 1-10 Sparks on easy, 10-25 on medium and 25-50 on hard.",
      "Approved quiz corrections and refunds now appear in **My result**. Dilemma also restores streaks broken by the corrected quiz.",
      "The player guide now updates in its original message when its text changes."
    ],
    pl: [
      "O miejscu w rankingu decyduje teraz suma **EXP**. Dotychczasowy postęp przechodzi na nowy system.",
      "Osoby zarządzające serwerem i opiekunowie Dilemmy mogą uruchomić quiz z tematu lub konkretnego pytania przez `/dilemma custom`. Custom i random mają osobne limity.",
      "Podgląd i 50/50 są darmowe. Każdego koła użyjesz raz w tygodniu. Nowe stawki to 1-10 Iskier w łatwym quizie, 10-25 w średnim i 25-50 w trudnym.",
      "Zatwierdzone poprawki i zwroty zobaczysz w panelu **Mój wynik**. Dilemma przywraca też serie przerwane przez poprawiony quiz.",
      "Gdy zmienia się treść poradnika, Dilemma aktualizuje jego dotychczasową wiadomość."
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
