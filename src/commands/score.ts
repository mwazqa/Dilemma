import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";

export const scoreCommand = new SlashCommandBuilder().setName("score").setDescription("Your Dilemma score and server leaderboard.")
  .addSubcommand(sub => sub.setName("profile").setDescription("Show quiz points, accuracy and correct-answer streaks.")
    .addUserOption(option => option.setName("user").setDescription("Player; defaults to you.")))
  .addSubcommand(sub => sub.setName("leaderboard").setDescription("Show this server's top ten players."))
  .addSubcommand(sub => sub.setName("forget").setDescription("Delete your stored quiz answers and score on this server.")
    .addBooleanOption(option => option.setName("confirm").setDescription("Confirm permanent deletion. Future votes can earn points again.").setRequired(true)));

const rankIcons = ["🥇", "🥈", "🥉"];

function progressBar(value: number, size = 10) {
  const filled = Math.round(value / 100 * size);
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)} ${value}%`;
}

function avatarUrl(user: { displayAvatarURL?: (options: { size: number }) => string }) {
  return user.displayAvatarURL?.({ size: 128 });
}

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
    const description = players.length ? players.map((player, i) => {
      const rank = rankIcons[i] ?? `**${i + 1}.**`;
      return `${rank} <@${player.userId}>\n> **${player.points}** pts · ${player.correct}/${player.answered} correct · 🔥 ${player.bestStreak}`;
    }).join("\n\n") : text("scoreEmpty");
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(text("leaderboardTitle").replace(/\*\*/g, ""))
      .setDescription(description);
    await reply({
      content: null,
      embeds: [embed]
    });
    return;
  }
  const user = interaction.options.getUser("user") ?? interaction.user;
  const player = await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: user.id } } });
  const answered = player?.answered ?? 0;
  const correct = player?.correct ?? 0;
  const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const displayName = (interaction.guild?.members.cache.get(user.id)?.displayName
    ?? user.displayName ?? user.username ?? text("scorePlayer")).replace(/[\r\n]+/g, " ");
  const embed = new EmbedBuilder()
    .setColor(0x06b6d4)
    .setTitle(text("scoreProfile", { user: displayName, points: player?.points ?? 0, answered, correct, accuracy,
      streak: player?.currentStreak ?? 0, best: player?.bestStreak ?? 0 }).split("\n")[0].replace(/\*\*/g, ""))
    .setDescription(`**${player?.points ?? 0}** points\n${progressBar(accuracy)}`)
    .addFields(
      { name: `📚 ${text("scoreAnswers")}`, value: String(answered), inline: true },
      { name: `✅ ${text("scoreCorrect")}`, value: String(correct), inline: true },
      { name: `🔥 ${text("scoreStreak")}`, value: `${player?.currentStreak ?? 0} / ${player?.bestStreak ?? 0}`, inline: true }
    );
  const avatar = avatarUrl(user);
  if (avatar) embed.setThumbnail(avatar);
  await reply({
    content: null,
    embeds: [embed]
  });
}
