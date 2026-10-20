import { isAchievementId, type AchievementId } from "./achievements.js";

const lavender = "#ad94f3";
const gold = "#f2c879";
const symbols: Record<AchievementId, string> = {
  first_answer: `<path d="M 22 16 H 44 A 8 8 0 0 1 52 24 V 37 A 8 8 0 0 1 44 45 H 29 L 17 53 V 44 A 8 8 0 0 1 12 37 V 24 A 8 8 0 0 1 20 16 Z"/>
    <path d="M 32 22 L 35 29 L 42 32 L 35 35 L 32 42 L 29 35 L 22 32 L 29 29 Z" fill="${gold}" stroke="none"/>`,
  correct_10: `<circle cx="31" cy="34" r="20"/><circle cx="31" cy="34" r="11"/>
    <path d="M 31 34 L 49 16 M 41 16 H 49 V 24" stroke="${gold}"/>
    <circle cx="31" cy="34" r="3" fill="${gold}" stroke="none"/>`,
  answers_100: `<path d="M 14 23 V 48 A 5 5 0 0 0 19 53 H 39 M 19 18 V 43 A 5 5 0 0 0 24 48 H 44" opacity="0.65"/>
    <rect x="24" y="12" width="28" height="31" rx="5"/>
    <path d="M 31 21 H 44 M 31 28 H 39"/>
    <path d="M 33 35 L 36 38 L 43 31" stroke="${gold}"/>`,
  streak_10: `<path d="M 32 10 C 34 23 43 23 42 35 C 46 31 48 29 48 25 C 57 40 49 54 34 55 C 19 56 10 46 15 35 C 17 30 22 23 22 19 C 29 25 25 31 29 33 C 33 28 34 21 32 10 Z"/>
    <path d="M 32 37 C 22 48 28 53 33 53 C 42 53 44 47 32 37 Z" fill="${gold}" stroke="none"/>`,
  level_2: `<path d="M 47 15 A 23 23 0 1 1 17 15"/>
    <path d="M 18 34 L 32 20 L 46 34 M 32 21 V 46" stroke="${gold}"/>`,
  level_5: `<circle cx="32" cy="32" r="21"/>
    <path d="M 32 11 V 16 M 53 32 H 48 M 32 53 V 48 M 11 32 H 16"/>
    <path d="M 42 22 L 35 35 L 22 42 L 29 29 Z"/>
    <path d="M 42 22 L 35 35 L 29 29 Z" fill="${gold}" stroke="${gold}"/>`
};

export function achievementIcon(id: AchievementId): string {
  if (!isAchievementId(id)) return "";
  return `<rect x="1" y="1" width="62" height="62" rx="17" fill="#222340" stroke="${lavender}" stroke-opacity="0.5"/>
    <g fill="none" stroke="${lavender}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${symbols[id]}</g>`;
}
