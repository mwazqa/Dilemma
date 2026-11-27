BEGIN;

CREATE TABLE "QuizWeeklyToolUse" (
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "weekStart" TEXT NOT NULL,
  CONSTRAINT "QuizWeeklyToolUse_pkey" PRIMARY KEY ("guildId", "userId", "kind")
);

ALTER TABLE "QuizWager"
  DROP CONSTRAINT "QuizWager_amount_check",
  ADD CONSTRAINT "QuizWager_amount_check" CHECK ("amount" BETWEEN 1 AND 50);

COMMIT;
