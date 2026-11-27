import { experienceProgress } from "./experience.js";

export const correctAnswerSparks = { easy: 1, medium: 2, hard: 3 } as const;
export const wrongAnswerPenalties = { easy: 2, medium: 3, hard: 4 } as const;
export const sparksPerLevel = 5;
export const expPerSpark = 3;
export const minExchangeSparks = 3;
export const maxWalletValue = 2_147_483_647;
export const maxExchangeSparks = Math.floor(maxWalletValue / expPerSpark);

export function levelUpSparks(previousExp: number | bigint, newExp: number | bigint): number {
  const levels = experienceProgress(newExp).level - experienceProgress(previousExp).level;
  return levels * sparksPerLevel;
}
