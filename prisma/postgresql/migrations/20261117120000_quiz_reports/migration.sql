CREATE TABLE "QuizReport" (
    "id" TEXT NOT NULL,
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
    "quizCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "analysis" TEXT,
    "analyzedAt" TIMESTAMP(3),
    CONSTRAINT "QuizReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizReport_messageId_reporterUserId_key" ON "QuizReport"("messageId", "reporterUserId");
CREATE INDEX "QuizReport_reviewedAt_createdAt_id_idx" ON "QuizReport"("reviewedAt", "createdAt", "id");
