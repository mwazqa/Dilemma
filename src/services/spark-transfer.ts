import { maxWalletValue } from "./sparks.js";
import { walletTransaction } from "./wallet-transaction.js";

export const minTransferSparks = 1;
export const maxTransferSparks = maxWalletValue;

export async function transferSparks(interactionId: string, guildId: string, senderUserId: string, recipientUserId: string, amount: number) {
  if (![interactionId, guildId, senderUserId, recipientUserId].every(id => typeof id === "string" && id.length > 0 && id.length <= 100) ||
      !Number.isSafeInteger(amount) || amount < minTransferSparks || amount > maxTransferSparks) return { status: "invalid" as const };
  if (senderUserId === recipientUserId) return { status: "self" as const };
  return walletTransaction(async tx => {
    const existing = await tx.sparkTransfer.findUnique({ where: { interactionId } });
    if (existing) {
      if (existing.guildId !== guildId || existing.senderUserId !== senderUserId || existing.recipientUserId !== recipientUserId || existing.amount !== amount) {
        return { status: "invalid" as const };
      }
      return { status: "transferred" as const, receipt: existing };
    }
    const senderKey = { guildId_userId: { guildId, userId: senderUserId } };
    const recipientKey = { guildId_userId: { guildId, userId: recipientUserId } };
    const sender = await tx.userScore.findUnique({ where: senderKey, select: { sparks: true } });
    if (!sender || sender.sparks < amount) return { status: "insufficient" as const, balance: sender?.sparks ?? 0 };
    const recipient = await tx.userScore.findUnique({ where: recipientKey, select: { sparks: true } });
    if ((recipient?.sparks ?? 0) > maxWalletValue - amount) return { status: "limit" as const };
    for (const userId of [senderUserId, recipientUserId].sort()) {
      await tx.userScore.upsert({ where: { guildId_userId: { guildId, userId } }, create: { guildId, userId, sparks: 0 },
        update: { sparks: { increment: 0 } } });
    }
    await tx.userScore.update({ where: senderKey, data: { sparks: { decrement: amount } } });
    await tx.userScore.update({ where: recipientKey, data: { sparks: { increment: amount } } });
    const receipt = await tx.sparkTransfer.create({ data: { interactionId, guildId, senderUserId, recipientUserId, amount } });
    return { status: "transferred" as const, receipt };
  });
}
