import { db } from "../db.js";
import { Prisma } from "@prisma/client";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";

export class QuizChannelAccessError extends Error {
  constructor(readonly feedback: "quizChannelInvalid" | "quizChannelPermissions") {
    super("Quiz channel unavailable");
    this.name = "QuizChannelAccessError";
  }
}

export async function resolveQuizChannel(guild: Guild | null, channelId: string, checkPermissions = true) {
  if (!guild) throw new QuizChannelAccessError("quizChannelInvalid");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.guildId !== guild.id || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new QuizChannelAccessError("quizChannelInvalid");
  }
  if (checkPermissions) {
    const member = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!member || !channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw new QuizChannelAccessError("quizChannelPermissions");
  }
  return channel;
}

export class RandomQuizChannelError extends Error {
  constructor() {
    super("Random quizzes are not enabled in this channel");
    this.name = "RandomQuizChannelError";
  }
}

export async function isQuizChannel(guildId: string, channelId: string): Promise<boolean> {
  return Boolean(await db.quizChannel.findUnique({ where: { guildId_channelId: { guildId, channelId } }, select: { channelId: true } }));
}

export async function requireQuizChannel(guildId: string, channelId: string): Promise<void> {
  if (!await canUseRandomQuizChannel(guildId, channelId)) throw new RandomQuizChannelError();
}

export async function canUseRandomQuizChannel(guildId: string, channelId: string): Promise<boolean> {
  if (await isQuizChannel(guildId, channelId)) return true;
  return !await db.quizChannel.findFirst({ where: { guildId }, select: { channelId: true } });
}

export async function assignQuizChannel(guildId: string, channelId: string): Promise<void> {
  const key = { guildId, channelId };
  try { await db.quizChannel.upsert({ where: { guildId_channelId: key }, create: key, update: {} }); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || !await isQuizChannel(guildId, channelId)) throw error;
  }
}
