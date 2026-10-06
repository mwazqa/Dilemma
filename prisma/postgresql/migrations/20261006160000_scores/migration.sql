CREATE TABLE "QuizSettlement" (
 "messageId" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "channelId" TEXT NOT NULL,
 "difficulty" TEXT NOT NULL, "correctAnswerId" INTEGER NOT NULL, "answerIds" TEXT NOT NULL,
 "expiresAt" TIMESTAMP NOT NULL, "closedAt" TIMESTAMP, "scoredAt" TIMESTAMP,
 "nextCheckAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "QuizAnswer" (
 "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "guildId" TEXT NOT NULL,
 "answerId" INTEGER NOT NULL, "correct" BOOLEAN NOT NULL, "points" INTEGER NOT NULL,
 "finishedAt" TIMESTAMP NOT NULL,
 CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("messageId", "userId"),
 CONSTRAINT "QuizAnswer_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "QuizSettlement" ("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "UserScore" (
 "guildId" TEXT NOT NULL, "userId" TEXT NOT NULL, "points" INTEGER NOT NULL DEFAULT 0,
 "answered" INTEGER NOT NULL DEFAULT 0, "correct" INTEGER NOT NULL DEFAULT 0,
 "currentStreak" INTEGER NOT NULL DEFAULT 0, "bestStreak" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP NOT NULL,
 CONSTRAINT "UserScore_pkey" PRIMARY KEY ("guildId", "userId")
);
CREATE INDEX "QuizSettlement_scoredAt_nextCheckAt_idx" ON "QuizSettlement" ("scoredAt", "nextCheckAt");
CREATE INDEX "QuizSettlement_guildId_idx" ON "QuizSettlement" ("guildId");
CREATE INDEX "QuizAnswer_guildId_userId_finishedAt_messageId_idx" ON "QuizAnswer" ("guildId", "userId", "finishedAt", "messageId");
CREATE INDEX "UserScore_guildId_points_idx" ON "UserScore" ("guildId", "points");
