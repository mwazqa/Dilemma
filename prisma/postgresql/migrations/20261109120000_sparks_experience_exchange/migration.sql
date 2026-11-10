ALTER TABLE "UserScore" ADD COLUMN "bonusExp" INTEGER NOT NULL DEFAULT 0 CHECK ("bonusExp" >= 0);

CREATE TABLE "SparkExchange" (
  "interactionId" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sparksSpent" INTEGER NOT NULL,
  "expGained" INTEGER NOT NULL,
  "sparksAfter" INTEGER NOT NULL,
  "levelAfter" INTEGER NOT NULL,
  "levelReward" INTEGER NOT NULL,
  CONSTRAINT "SparkExchange_guildId_userId_fkey" FOREIGN KEY ("guildId", "userId") REFERENCES "UserScore" ("guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SparkExchange_guildId_userId_idx" ON "SparkExchange"("guildId", "userId");
