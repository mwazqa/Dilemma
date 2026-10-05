-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "nextGenerationAt" DATETIME,
    "generationTime" TEXT,
    "lastGeneratedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Topic_guildId_idx" ON "Topic"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_guildId_name_key" ON "Topic"("guildId", "name");

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "language" TEXT NOT NULL DEFAULT 'en',
    "defaultIntervalDays" INTEGER NOT NULL DEFAULT 1,
    "defaultQuestionsPerRun" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeneratedPoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "topicEmoji" TEXT NOT NULL DEFAULT '✨',
    "optionEmojis" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "GeneratedPoll_messageId_key" UNIQUE ("messageId")
);

-- CreateIndex
CREATE INDEX "GeneratedPoll_guildId_createdAt_idx" ON "GeneratedPoll"("guildId", "createdAt");

-- CreateTable
CREATE TABLE "RandomPoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "optionEmojis" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "RandomPoll_messageId_key" UNIQUE ("messageId")
);

-- CreateIndex
CREATE INDEX "RandomPoll_guildId_createdAt_idx" ON "RandomPoll"("guildId", "createdAt");
