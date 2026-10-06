import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";

export const scoreCommand = new SlashCommandBuilder().setName("score").setDescription("Your Dilemma score and server leaderboard.")
  .addSubcommand(sub => sub.setName("profile").setDescription("Show quiz points, accuracy and correct-answer streaks.")
    .addUserOption(option => option.setName("user").setDescription("Player; defaults to you.")))
  .addSubcommand(sub => sub.setName("leaderboard").setDescription("Show this server's top ten players."))
  .addSubcommand(sub => sub.setName("forget").setDescription("Delete your stored quiz answers and score on this server.")
    .addBooleanOption(option => option.setName("confirm").setDescription("Confirm permanent deletion. Future votes can earn points again.").setRequired(true)));

export async function handleScore(interaction: ChatInputCommandInteraction) {
  const { text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();
  if (sub === "forget") {
    if (!interaction.options.getBoolean("confirm", true)) { await reply(text("forgetConfirm")); return; }
    await db.$transaction(async tx => {
      await tx.quizAnswer.deleteMany({ where: { guildId, userId: interaction.user.id } });
      await tx.userScore.deleteMany({ where: { guildId, userId: interaction.user.id } });
    }, { isolationLevel: "Serializable" });
    await reply(text("scoreForgotten"));
    return;
  }
  if (sub === "leaderboard") {
    const players = await db.userScore.findMany({ where: { guildId, answered: { gt: 0 } },
      orderBy: [{ points: "desc" }, { correct: "desc" }, { userId: "asc" }], take: 10 });
    await reply(players.length ? text("leaderboardTitle") + "\n" + players.map((player, i) =>
      text("leaderboardRow", { rank: i + 1, user: `<@${player.userId}>`, points: player.points, streak: player.bestStreak })).join("\n") : text("scoreEmpty"));
    return;
  }
  const user = interaction.options.getUser("user") ?? interaction.user;
  const player = await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: user.id } } });
  await reply(text("scoreProfile", { user: `<@${user.id}>`, points: player?.points ?? 0, answered: player?.answered ?? 0,
    correct: player?.correct ?? 0, accuracy: player?.answered ? Math.round(player.correct / player.answered * 100) : 0,
    streak: player?.currentStreak ?? 0, best: player?.bestStreak ?? 0 }) + "\n" + text("scoreRules"));
}
