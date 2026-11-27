CREATE TABLE "QuizGenerationRule" (
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizGenerationRule_pkey" PRIMARY KEY ("key")
);
