BEGIN;

ALTER TABLE "UserScore" ADD COLUMN "exp" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "QuizAnswer" ADD COLUMN "baseExp" INTEGER NOT NULL DEFAULT 0;

UPDATE "UserScore" SET "exp" = "points"::BIGINT * 10 + "bonusExp";
UPDATE "QuizAnswer" SET "baseExp" = "points" * 10;

DROP INDEX "UserScore_guildId_points_idx";
ALTER TABLE "UserScore" DROP COLUMN "points", DROP COLUMN "bonusExp";
ALTER TABLE "QuizAnswer" DROP COLUMN "points";

CREATE INDEX "UserScore_guildId_exp_correct_userId_idx" ON "UserScore"("guildId", "exp" DESC, "correct" DESC, "userId");

COMMIT;
