CREATE TABLE "QuizCharge" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fees" INTEGER NOT NULL,
    CONSTRAINT "QuizCharge_pkey" PRIMARY KEY ("messageId", "userId"),
    CONSTRAINT "QuizCharge_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "QuizCorrection" (
    "messageId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "refundedSparks" BIGINT NOT NULL,
    "refundedPlayers" INTEGER NOT NULL,
    CONSTRAINT "QuizCorrection_pkey" PRIMARY KEY ("messageId"),
    CONSTRAINT "QuizCorrection_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "QuizSettlement"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "QuizCorrection_publishedAt_approvedAt_idx" ON "QuizCorrection"("publishedAt", "approvedAt");

CREATE TABLE "QuizRefund" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "penalty" INTEGER NOT NULL,
    "stake" INTEGER NOT NULL,
    "fees" INTEGER NOT NULL,
    CONSTRAINT "QuizRefund_pkey" PRIMARY KEY ("messageId", "userId"),
    CONSTRAINT "QuizRefund_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "QuizCorrection"("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);
