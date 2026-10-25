import { PermissionFlagsBits, type Guild } from "discord.js";
import { resolveQuizChannel } from "./quiz-channels.js";

export class QuizPingError extends Error {
  constructor(readonly feedback: "quizPingRoleInvalid" | "quizPingPermissions") {
    super("Quiz notification role unavailable");
    this.name = "QuizPingError";
  }
}

export async function resolveQuizPingRole(guild: Guild | null, channelId: string, roleId: string): Promise<string> {
  if (!guild || roleId === guild.id) throw new QuizPingError("quizPingRoleInvalid");
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  if (!role || role.id !== roleId || role.guild.id !== guild.id) throw new QuizPingError("quizPingRoleInvalid");
  const channel = await resolveQuizChannel(guild, channelId, false);
  if (!role.mentionable) {
    const member = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!member || !channel.permissionsFor(member)?.has(PermissionFlagsBits.MentionEveryone)) {
      throw new QuizPingError("quizPingPermissions");
    }
  }
  return role.id;
}
