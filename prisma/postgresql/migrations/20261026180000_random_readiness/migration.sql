ALTER TABLE "GuildSettings" ADD COLUMN "randomPingRoleId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "randomCooldownResetAt" TIMESTAMP(3);
ALTER TABLE "RandomPoll" ADD COLUMN "readyPingSentAt" TIMESTAMP(3);
