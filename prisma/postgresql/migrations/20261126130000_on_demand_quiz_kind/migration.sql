ALTER TABLE "RandomPoll" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'random';
CREATE INDEX "RandomPoll_guildId_kind_createdAt_idx" ON "RandomPoll"("guildId", "kind", "createdAt");
