ALTER TABLE "GeneratedPoll" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "GeneratedPoll" ADD COLUMN "closedByUserId" TEXT;
ALTER TABLE "GeneratedPoll" ADD COLUMN "closeSource" TEXT;

ALTER TABLE "RandomPoll" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "RandomPoll" ADD COLUMN "closedByUserId" TEXT;
ALTER TABLE "RandomPoll" ADD COLUMN "closeSource" TEXT;
