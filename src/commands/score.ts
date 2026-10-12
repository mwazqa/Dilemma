import { AttachmentBuilder, EmbedBuilder, SlashCommandSubcommandGroupBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { openFeedback } from "../feedback.js";
import { experienceProgress } from "../services/experience.js";
import { boundedText, renderScoreCard } from "../services/score-card.js";
import { serverRank } from "../services/score-ranking.js";

export const scoreCommand = new SlashCommandSubcommandGroupBuilder().setName("score").setDescription("Your Dilemma score and server leaderboard.")
  .addSubcommand(sub => sub.setName("profile").setDescription("Show quiz level, EXP, points, accuracy and correct-answer streaks.")
    .addUserOption(option => option.setName("user").setDescription("Player; defaults to you.")))
  .addSubcommand(sub => sub.setName("leaderboard").setDescription("Show this server's top ten players."))
  .addSubcommand(sub => sub.setName("forget").setDescription("Delete your stored quiz answers and score on this server.")
    .addBooleanOption(option => option.setName("confirm").setDescription("Confirm permanent deletion. Future votes can earn points again.").setRequired(true)));

const rankIcons = ["🥇", "🥈", "🥉"];

function progressBar(value: number, size = 10) {
  const filled = Math.floor(value / 100 * size);
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)} ${value}%`;
}

function avatarUrl(user: { displayAvatarURL?: (options: { size: number; extension: "png"; forceStatic: boolean }) => string }) {
  return user.displayAvatarURL?.({ size: 128, extension: "png", forceStatic: true });
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
      const progress = experienceProgress(player.points);
      const accuracy = player.answered ? Math.round(player.correct / player.answered * 100) : 0;
      return `${rank} <@${player.userId}>\n> ${text("scoreLevel", { level: progress.level })} · ${text("scorePoints", { points: player.points })}\n> ${text("scoreAnswers")}: ${player.answered} · ${text("scoreCorrect")}: ${player.correct} (${accuracy}%) · 🔥 ${player.bestStreak}`;
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
  const progress = experienceProgress(player?.points ?? 0);
  const rank = await serverRank(guildId, user.id, player);
  const displayName = (interaction.guild?.members.cache.get(user.id)?.displayName
    ?? user.displayName ?? user.username ?? text("scorePlayer")).replace(/[\r\n]+/g, " ");
  const title = displayName;
  const rankLabel = rank === null ? text("scoreUnranked") : text("scoreRank", { rank });
  const avatar = avatarUrl(user);
  const cardData = {
    title, level: text("scoreLevel", { level: progress.level }),
    rank,
    points: text("scorePoints", { points: player?.points ?? 0 }).replace(/\*\*/g, ""),
    experience: text("scoreExpProgress", { earned: progress.earned, required: progress.required }),
    percent: progress.percent,
    answersLabel: text("scoreAnswers"), answers: String(answered),
    correctLabel: text("scoreCorrect"), correct: `${correct} (${accuracy}%)`,
    streakLabel: text("scoreStreak"), streak: `${player?.currentStreak ?? 0} / ${player?.bestStreak ?? 0}`
  };
  let card: Buffer | undefined;
  try { card = await renderScoreCard(cardData, avatar); }
  catch { /* Keep the textual fallback; never log players' data or native image errors. */ }
  if (card) {
    const alt = `${title}\n${cardData.level} · ${cardData.points}\n${rankLabel}\n${cardData.experience} (${progress.percent}%)\n${cardData.answersLabel}: ${answered}\n${cardData.correctLabel}: ${cardData.correct}\n${cardData.streakLabel}: ${cardData.streak}`;
    const attachment = new AttachmentBuilder(card, { name: "quiz-profile.png", description: boundedText(alt, 1000) });
    await reply({ content: null, embeds: [new EmbedBuilder().setColor(0xad94f3).setImage("attachment://quiz-profile.png")], files: [attachment] });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0xad94f3)
    .setTitle(boundedText(title, 250))
    .setDescription(`**${cardData.level}** · ${rank === null ? rankLabel : `#${rank}`}\n${text("scorePoints", { points: player?.points ?? 0 })}\n${cardData.experience}\n${progressBar(progress.percent)}`)
    .addFields(
      { name: `📚 ${text("scoreAnswers")}`, value: String(answered), inline: true },
      { name: `✅ ${text("scoreCorrect")}`, value: cardData.correct, inline: true },
      { name: `🔥 ${text("scoreStreak")}`, value: `${player?.currentStreak ?? 0} / ${player?.bestStreak ?? 0}`, inline: true }
    );
  if (avatar) embed.setThumbnail(avatar);
  await reply({
    content: null,
    embeds: [embed]
  });
}
