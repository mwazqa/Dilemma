ALTER TABLE "QuizSettlement" ADD COLUMN "votingMode" TEXT NOT NULL DEFAULT 'native';
ALTER TABLE "QuizSettlement" ADD COLUMN "finalCounts" TEXT;
CREATE TABLE "QuizVote" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "answerId" INTEGER NOT NULL,
  PRIMARY KEY ("messageId", "userId"),
  FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuizVote_guildId_userId_idx" ON "QuizVote"("guildId", "userId");
CREATE TABLE "QuizSupport" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "revealed" BOOLEAN NOT NULL DEFAULT false,
  "hintAnswerIds" TEXT,
  PRIMARY KEY ("messageId", "userId"),
  FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuizSupport_guildId_userId_idx" ON "QuizSupport"("guildId", "userId");
CREATE TABLE "QuizWager" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "answerId" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" BETWEEN 1 AND 20),
  "payout" INTEGER CHECK ("payout" >= 0),
  PRIMARY KEY ("messageId", "userId"),
  FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuizWager_guildId_userId_idx" ON "QuizWager"("guildId", "userId");
