import type { Prisma } from "@prisma/client";
import { db } from "../db.js";

interface RankedScore { exp: bigint; correct: number; answered: number }
export const rankEligibility = { OR: [{ exp: { gt: 0n } }, { answered: { gt: 0 } }] } satisfies Prisma.UserScoreWhereInput;
export const rankOrder = [{ exp: "desc" }, { correct: "desc" }, { userId: "asc" }] satisfies Prisma.UserScoreOrderByWithRelationInput[];

export async function serverRank(guildId: string, userId: string, player: RankedScore | null): Promise<number | null> {
  if (!player || (player.answered <= 0 && player.exp <= 0n)) return null;
  const ahead = await db.userScore.count({ where: {
    guildId, ...rankEligibility,
    AND: { OR: [
      { exp: { gt: player.exp } },
      { exp: player.exp, correct: { gt: player.correct } },
      { exp: player.exp, correct: player.correct, userId: { lt: userId } }
    ] }
  } });
  return ahead + 1;
}
