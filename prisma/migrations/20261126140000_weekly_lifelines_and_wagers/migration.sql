CREATE TABLE "QuizWeeklyToolUse" (
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "weekStart" TEXT NOT NULL,
  PRIMARY KEY ("guildId", "userId", "kind")
);

CREATE TABLE "new_QuizWager" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "answerId" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" BETWEEN 1 AND 50),
  "payout" INTEGER CHECK ("payout" >= 0),
  PRIMARY KEY ("messageId", "userId"),
  FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizWager" ("messageId", "userId", "guildId", "answerId", "amount", "payout")
SELECT "messageId", "userId", "guildId", "answerId", "amount", "payout" FROM "QuizWager";
DROP TABLE "QuizWager";
ALTER TABLE "new_QuizWager" RENAME TO "QuizWager";
CREATE INDEX "QuizWager_guildId_userId_idx" ON "QuizWager"("guildId", "userId");
