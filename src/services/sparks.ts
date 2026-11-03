import { experienceProgress } from "./experience.js";

export const wrongAnswerPenalties = { easy: 2, medium: 3, hard: 4 } as const;

export function earnedSparks(totalPoints: number, earnedPoints: number): number {
  const levels = experienceProgress(totalPoints).level - experienceProgress(totalPoints - earnedPoints).level;
  return earnedPoints + levels * 5;
}
