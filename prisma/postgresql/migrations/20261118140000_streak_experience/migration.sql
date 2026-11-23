ALTER TABLE "QuizAnswer" ADD COLUMN "streakExp" INTEGER NOT NULL DEFAULT 0 CHECK ("streakExp" >= 0 AND "streakExp" <= 40);
