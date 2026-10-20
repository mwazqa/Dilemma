export const experiencePerPoint = 10;

export function levelThreshold(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError("Invalid level");
  const threshold = 50 * level * (level - 1);
  if (!Number.isSafeInteger(threshold)) throw new RangeError("Level threshold is too large");
  return threshold;
}

export function experienceProgress(points: number) {
  if (!Number.isSafeInteger(points) || points < 0) throw new RangeError("Invalid points");
  const totalExp = points * experiencePerPoint;
  if (!Number.isSafeInteger(totalExp)) throw new RangeError("Experience is too large");
  let level = Math.floor((1 + Math.sqrt(1 + totalExp * 0.08)) / 2);
  while (level > 1 && levelThreshold(level) > totalExp) level--;
  while (levelThreshold(level + 1) <= totalExp) level++;
  const earned = totalExp - levelThreshold(level);
  const required = levelThreshold(level + 1) - levelThreshold(level);
  const percent = Math.floor(earned / required * 100);
  return { level, totalExp, earned, required, remaining: required - earned, percent };
}
