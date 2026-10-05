CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "questionsPerRun" INTEGER NOT NULL DEFAULT 3,
    "options" TEXT NOT NULL,
    "optionCount" INTEGER NOT NULL DEFAULT 4,
    "questionsGenerated" INTEGER NOT NULL DEFAULT 0,
    "channelId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextGenerationAt" TIMESTAMP(3),
    "generationTime" TEXT,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "defaultIntervalDays" INTEGER NOT NULL DEFAULT 1,
    "defaultQuestionsPerRun" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "GeneratedPoll" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "topicEmoji" TEXT NOT NULL DEFAULT '',
    "optionEmojis" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "GeneratedPoll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Topic_guildId_name_key" ON "Topic"("guildId", "name");
CREATE INDEX "Topic_guildId_idx" ON "Topic"("guildId");
CREATE UNIQUE INDEX "GeneratedPoll_messageId_key" ON "GeneratedPoll"("messageId");
CREATE INDEX "GeneratedPoll_guildId_createdAt_idx" ON "GeneratedPoll"("guildId", "createdAt");

CREATE TABLE "RandomPoll" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "optionEmojis" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "RandomPoll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RandomPoll_messageId_key" ON "RandomPoll"("messageId");
CREATE INDEX "RandomPoll_guildId_createdAt_idx" ON "RandomPoll"("guildId", "createdAt");
