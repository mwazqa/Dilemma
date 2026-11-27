import { experienceProgress, maxExperience } from "./experience.js";
import { expPerSpark, levelUpSparks, maxExchangeSparks, maxWalletValue, minExchangeSparks } from "./sparks.js";
import { walletTransaction } from "./wallet-transaction.js";

export async function exchangeSparks(interactionId: string, guildId: string, userId: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > maxExchangeSparks) return { status: "invalid" as const };

  return walletTransaction(async tx => {
    const existing = await tx.sparkExchange.findUnique({ where: { interactionId } });
    if (existing) {
      if (existing.guildId !== guildId || existing.userId !== userId || existing.sparksSpent !== amount) return { status: "invalid" as const };
      return { status: "exchanged" as const, receipt: existing };
    }
    if (amount < minExchangeSparks) return { status: "invalid" as const };

    const where = { guildId_userId: { guildId, userId } };
    const player = await tx.userScore.findUnique({ where, select: { sparks: true, exp: true } });
    if (!player || player.sparks < amount) return { status: "insufficient" as const, balance: player?.sparks ?? 0 };

    const expGained = amount * expPerSpark;
    const exp = player.exp + BigInt(expGained);
    if (exp > maxExperience) return { status: "limit" as const };

    const levelAfter = experienceProgress(exp).level;
    const levelReward = levelUpSparks(player.exp, exp);
    const sparksAfter = player.sparks - amount + levelReward;
    if (sparksAfter > maxWalletValue) return { status: "limit" as const };

    await tx.userScore.update({ where, data: { sparks: sparksAfter, exp } });
    const receipt = await tx.sparkExchange.create({
      data: { interactionId, guildId, userId, sparksSpent: amount, expGained, sparksAfter, levelAfter, levelReward }
    });
    return { status: "exchanged" as const, receipt };
  });
}
