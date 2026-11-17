CREATE TABLE "GuidePublication" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "genericAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuidePublication_pkey" PRIMARY KEY ("messageId")
);
CREATE INDEX "GuidePublication_active_guildId_channelId_idx" ON "GuidePublication"("active", "guildId", "channelId");
CREATE INDEX "GuidePublication_genericAt_idx" ON "GuidePublication"("genericAt");

CREATE TABLE "GuideReleaseNotice" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "messageId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuideReleaseNotice_pkey" PRIMARY KEY ("guildId", "channelId", "version")
);

CREATE TABLE "GuideDiscovery" (
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'messages',
    "guildId" TEXT NOT NULL,
    "cursor" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuideDiscovery_pkey" PRIMARY KEY ("channelId", "kind")
);
CREATE INDEX "GuideDiscovery_completedAt_idx" ON "GuideDiscovery"("completedAt");
