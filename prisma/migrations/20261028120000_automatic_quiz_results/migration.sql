ALTER TABLE "QuizSettlement" ADD COLUMN "resultsPending" BOOLEAN NOT NULL DEFAULT true;

UPDATE "QuizSettlement"
SET "resultsPending" = false
WHERE "scoredAt" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "GeneratedPoll" WHERE "GeneratedPoll"."messageId" = "QuizSettlement"."messageId" AND "GeneratedPoll"."endedAt" IS NOT NULL)
   OR EXISTS (SELECT 1 FROM "RandomPoll" WHERE "RandomPoll"."messageId" = "QuizSettlement"."messageId" AND "RandomPoll"."endedAt" IS NOT NULL);

CREATE INDEX "QuizSettlement_resultsPending_nextCheckAt_idx" ON "QuizSettlement"("resultsPending", "nextCheckAt");
