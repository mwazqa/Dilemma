CREATE TABLE "SparkTransfer" (
    "interactionId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "recipientUserId" TEXT,
    "amount" INTEGER NOT NULL CHECK ("amount" > 0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SparkTransfer_pkey" PRIMARY KEY ("interactionId")
);

CREATE INDEX "SparkTransfer_guildId_senderUserId_idx" ON "SparkTransfer"("guildId", "senderUserId");
CREATE INDEX "SparkTransfer_guildId_recipientUserId_idx" ON "SparkTransfer"("guildId", "recipientUserId");
