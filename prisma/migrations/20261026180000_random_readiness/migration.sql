ALTER TABLE "GuildSettings" ADD COLUMN "randomPingRoleId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "randomCooldownResetAt" DATETIME;
ALTER TABLE "RandomPoll" ADD COLUMN "readyPingSentAt" DATETIME;
