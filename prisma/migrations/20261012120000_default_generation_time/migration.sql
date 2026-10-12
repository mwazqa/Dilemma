-- Preserve existing topic schedules; only newly created topics inherit this setting.
ALTER TABLE "GuildSettings" ADD COLUMN "defaultGenerationTime" TEXT;
