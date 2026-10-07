-- Keep legacy count columns for rollback compatibility; current commands no longer use them.
ALTER TABLE "Topic" ADD COLUMN "pollDurationHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "GuildSettings" ADD COLUMN "defaultPollDurationHours" INTEGER NOT NULL DEFAULT 24;

CREATE TABLE "DailyQuizRun" (
  "guildId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "slot" INTEGER NOT NULL,
  "messageId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyQuizRun_pkey" PRIMARY KEY ("guildId", "scope", "day", "slot")
);
