export const correctAnswerExp = { easy: 10, medium: 20, hard: 30 } as const;
export const maxExperience = BigInt(2 ** 52 - 1);
export const experiencePerStreakStep = 5;
export const streakBonusStartsAt = 3;
export const maxStreakBonusExp = 40;

export function streakExperience(streak: number): number {
  if (!Number.isSafeInteger(streak) || streak < 0) throw new RangeError("Invalid streak");
  return Math.min(Math.max(0, streak - streakBonusStartsAt + 1), maxStreakBonusExp / experiencePerStreakStep) * experiencePerStreakStep;
}

export function levelThreshold(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError("Invalid level");
  const threshold = 50 * level * (level - 1);
  if (!Number.isSafeInteger(threshold)) throw new RangeError("Level threshold is too large");
  return threshold;
}

export function experienceProgress(experience: number | bigint) {
  const totalExp = Number(experience);
  if (!Number.isSafeInteger(totalExp) || totalExp < 0 || totalExp > Number(maxExperience)) throw new RangeError("Invalid experience");
  let level = Math.floor((1 + Math.sqrt(1 + totalExp * 0.08)) / 2);
  while (level > 1 && levelThreshold(level) > totalExp) level--;
  while (levelThreshold(level + 1) <= totalExp) level++;
  const earned = totalExp - levelThreshold(level);
  const required = levelThreshold(level + 1) - levelThreshold(level);
  const percent = Math.floor(earned / required * 100);
  return { level, totalExp, earned, required, remaining: required - earned, percent };
}
