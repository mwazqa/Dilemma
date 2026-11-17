CREATE TABLE "GuidePublication" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "genericAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GuidePublication_active_guildId_channelId_idx" ON "GuidePublication"("active", "guildId", "channelId");
CREATE INDEX "GuidePublication_genericAt_idx" ON "GuidePublication"("genericAt");

CREATE TABLE "GuideReleaseNotice" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "messageId" TEXT,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("guildId", "channelId", "version")
);

CREATE TABLE "GuideDiscovery" (
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'messages',
    "guildId" TEXT NOT NULL,
    "cursor" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("channelId", "kind")
);
CREATE INDEX "GuideDiscovery_completedAt_idx" ON "GuideDiscovery"("completedAt");
