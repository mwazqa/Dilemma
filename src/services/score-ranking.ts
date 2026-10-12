import { db } from "../db.js";

interface RankedScore { points: number; correct: number; answered: number }

export async function serverRank(guildId: string, userId: string, player: RankedScore | null): Promise<number | null> {
  if (!player || player.answered <= 0) return null;
  // Use exactly the leaderboard's order, including its stable tie-breaker.
  const ahead = await db.userScore.count({ where: {
    guildId, answered: { gt: 0 },
    OR: [
      { points: { gt: player.points } },
      { points: player.points, correct: { gt: player.correct } },
      { points: player.points, correct: player.correct, userId: { lt: userId } }
    ]
  } });
  return ahead + 1;
}
