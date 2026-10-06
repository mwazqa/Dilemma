ALTER TABLE "Topic" ADD COLUMN "difficulty" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "GuildSettings" ADD COLUMN "defaultDifficulty" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "GeneratedPoll" ADD COLUMN "difficulty" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "RandomPoll" ADD COLUMN "difficulty" TEXT NOT NULL DEFAULT 'medium';
