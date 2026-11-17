CREATE TABLE "QuizReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "quizCreatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "analysis" TEXT,
    "analyzedAt" DATETIME
);

CREATE UNIQUE INDEX "QuizReport_messageId_reporterUserId_key" ON "QuizReport"("messageId", "reporterUserId");
CREATE INDEX "QuizReport_reviewedAt_createdAt_id_idx" ON "QuizReport"("reviewedAt", "createdAt", "id");
