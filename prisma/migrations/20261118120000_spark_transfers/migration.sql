CREATE TABLE "SparkTransfer" (
    "interactionId" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "recipientUserId" TEXT,
    "amount" INTEGER NOT NULL CHECK ("amount" > 0 AND "amount" <= 2147483647),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SparkTransfer_guildId_senderUserId_idx" ON "SparkTransfer"("guildId", "senderUserId");
CREATE INDEX "SparkTransfer_guildId_recipientUserId_idx" ON "SparkTransfer"("guildId", "recipientUserId");
