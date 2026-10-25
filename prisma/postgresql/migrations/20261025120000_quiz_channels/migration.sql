CREATE TABLE "QuizChannel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "QuizChannel_pkey" PRIMARY KEY ("guildId", "channelId")
);
