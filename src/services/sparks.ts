import { experienceProgress } from "./experience.js";

export const wrongAnswerPenalties = { easy: 2, medium: 3, hard: 4 } as const;
export const sparksPerLevel = 5;
export const expPerSpark = 3;
export const minExchangeSparks = 3;
export const maxWalletValue = 2_147_483_647;
export const maxExchangeSparks = Math.floor(maxWalletValue / expPerSpark);

export function earnedSparks(totalPoints: number, earnedPoints: number, bonusExp = 0): number {
  const levels = experienceProgress(totalPoints, bonusExp).level - experienceProgress(totalPoints - earnedPoints, bonusExp).level;
  return earnedPoints + levels * sparksPerLevel;
}
