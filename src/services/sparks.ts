import { experienceProgress } from "./experience.js";

export function earnedSparks(totalPoints: number, earnedPoints: number): number {
  const levels = experienceProgress(totalPoints).level - experienceProgress(totalPoints - earnedPoints).level;
  return earnedPoints + levels * 5;
}
