import { experiencePerPoint, experienceProgress, levelThreshold } from "./experience.js";

export interface AchievementScore {
  points: number;
  answered: number;
  correct: number;
  bestStreak: number;
}

export const achievements = [
  { id: "first_answer", name: "achievementFirstAnswer", goal: "achievementFirstAnswerGoal", metric: "answered", target: 1 },
  { id: "correct_10", name: "achievementCorrect10", goal: "achievementCorrect10Goal", metric: "correct", target: 10 },
  { id: "answers_100", name: "achievementAnswers100", goal: "achievementAnswers100Goal", metric: "answered", target: 100 },
  { id: "streak_10", name: "achievementStreak10", goal: "achievementStreak10Goal", metric: "bestStreak", target: 10 },
  { id: "level_2", name: "achievementLevel2", goal: "achievementLevel2Goal", metric: "level", target: 2 },
  { id: "level_5", name: "achievementLevel5", goal: "achievementLevel5Goal", metric: "level", target: 5 }
] as const;

export type AchievementId = typeof achievements[number]["id"];
export const maxDisplayedBadges = 3;
export const badgeOptionNames = ["achievement", "achievement_2", "achievement_3"] as const;

export function isAchievementId(value: unknown): value is AchievementId {
  return achievements.some(achievement => achievement.id === value);
}

export function decodeSelectedBadges(value?: string | null): AchievementId[] {
  if (!value || value.length > 256) return [];
  let ids: unknown = [value];
  if (value.startsWith("[")) {
    try { ids = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(ids) ? [...new Set(ids.filter(isAchievementId))].slice(0, maxDisplayedBadges) : [];
}

export function encodeSelectedBadges(ids: readonly AchievementId[]): string | null {
  if (ids.length > maxDisplayedBadges || new Set(ids).size !== ids.length || !ids.every(isAchievementId)) {
    throw new RangeError("Invalid badge selection");
  }
  return ids.length === 0 ? null : ids.length === 1 ? ids[0] : JSON.stringify(ids);
}

export function achievementProgress(score: AchievementScore | null) {
  const stats = score ?? { points: 0, answered: 0, correct: 0, bestStreak: 0 };
  const level = experienceProgress(stats.points).level;
  return achievements.map(achievement => {
    const value = achievement.metric === "level" ? level : stats[achievement.metric];
    return { ...achievement, current: Math.min(value, achievement.target), unlocked: value >= achievement.target };
  });
}

export function selectedAchievements(score: (AchievementScore & { selectedBadge?: string | null }) | null) {
  const progress = achievementProgress(score);
  return decodeSelectedBadges(score?.selectedBadge).flatMap(id => {
    const achievement = progress.find(item => item.id === id && item.unlocked);
    return achievement ? [achievement] : [];
  });
}

export function achievementRequirement(id: string) {
  const achievement = achievements.find(item => item.id === id);
  if (!achievement) return null;
  return achievement.metric === "level"
    ? { points: { gte: levelThreshold(achievement.target) / experiencePerPoint } }
    : { [achievement.metric]: { gte: achievement.target } };
}
