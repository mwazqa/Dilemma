import { AttachmentBuilder, EmbedBuilder, SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";
import { getGuildSettings } from "../services/guild-settings.js";
import { bulletList, inlineText } from "../formatting.js";
import { openFeedback } from "../feedback.js";
import { experienceProgress } from "../services/experience.js";
import { exchangeSparks } from "../services/spark-exchange.js";
import { maxTransferSparks, minTransferSparks, transferSparks } from "../services/spark-transfer.js";
import { expPerSpark, maxExchangeSparks, minExchangeSparks } from "../services/sparks.js";
import { boundedText, renderScoreCard } from "../services/score-card.js";
import { serverRank } from "../services/score-ranking.js";
import { achievementProgress, achievementRequirement, badgeOptionNames, encodeSelectedBadges, isAchievementId, maxDisplayedBadges, selectedAchievements } from "../services/achievements.js";
import { message, normalizeLanguage } from "../messages.js";

export const profileCommand = new SlashCommandSubcommandBuilder().setName("profile")
  .setDescription("Show a player's profile: level, EXP, points, Sparks, accuracy and streaks.")
  .addUserOption(option => option.setName("user").setDescription("Player; defaults to you."));

export const leaderboardCommand = new SlashCommandSubcommandBuilder().setName("leaderboard")
  .setDescription("Show this server's top ten players.");

export const achievementsCommand = new SlashCommandSubcommandBuilder().setName("achievements")
  .setDescription("Show unlocked quiz achievements and progress on this server.")
  .addUserOption(option => option.setName("user").setDescription("Player; defaults to you."));

export const sparksCommand = new SlashCommandSubcommandGroupBuilder().setName("sparks")
  .setDescription("Exchange your Sparks for EXP or send Sparks to another player.")
  .addSubcommand(sub => sub.setName("exchange").setDescription(`Spend Sparks for EXP. Each Spark gives ${expPerSpark} EXP.`)
    .addIntegerOption(option => option.setName("amount").setDescription(`Number of Sparks to spend now (minimum ${minExchangeSparks}).`)
      .setRequired(true).setMinValue(minExchangeSparks).setMaxValue(maxExchangeSparks)))
  .addSubcommand(sub => sub.setName("transfer").setDescription("Send your Sparks to another player on this server, without a fee.")
    .addUserOption(option => option.setName("user").setDescription("Player on this server who receives your Sparks.").setRequired(true))
    .addIntegerOption(option => option.setName("amount").setDescription("Whole number of Sparks to send.")
      .setRequired(true).setMinValue(minTransferSparks).setMaxValue(maxTransferSparks)));

export const badgesCommand = new SlashCommandSubcommandGroupBuilder().setName("badges")
  .setDescription("Choose the badges displayed on your player profile.")
  .addSubcommand(sub => sub.setName("set").setDescription("Choose up to three unlocked profile badges, or hide all badges.")
    .addStringOption(option => option.setName("achievement").setDescription("Choose an unlocked achievement, or no badge.")
      .setRequired(true).setAutocomplete(true).setMaxLength(32))
    .addStringOption(option => option.setName("achievement_2").setDescription("Second unlocked badge; omit to show fewer badges.")
      .setAutocomplete(true).setMaxLength(32))
    .addStringOption(option => option.setName("achievement_3").setDescription("Third unlocked badge; omit to show fewer badges.")
      .setAutocomplete(true).setMaxLength(32)));

const rankMarkers = ["✦ **1.**", "✧ **2.**", "⋆ **3.**"];

function progressBar(value: number, size = 10) {
  const filled = Math.floor(value / 100 * size);
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)} ${value}%`;
}

function avatarUrl(user: { displayAvatarURL?: (options: { size: number; extension: "png"; forceStatic: boolean }) => string }) {
  return user.displayAvatarURL?.({ size: 128, extension: "png", forceStatic: true });
}

export async function handleScore(interaction: ChatInputCommandInteraction, action = interaction.options.getSubcommand()) {
  const { text, reply } = await openFeedback(interaction);
  if (!interaction.guildId) { await reply(text("serverOnly")); return; }
  const guildId = interaction.guildId;
  const sub = action;
  if (!["profile", "leaderboard", "achievements", "exchange", "transfer", "badge"].includes(sub)) {
    await reply(text("commandUnavailable")); return;
  }
  if (sub === "transfer") {
    const recipient = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    if (!Number.isSafeInteger(amount) || amount < minTransferSparks || amount > maxTransferSparks) { await reply(text("scoreTransferInvalid")); return; }
    if (recipient.id === interaction.user.id) { await reply(text("scoreTransferSelf")); return; }
    if (recipient.bot || interaction.user.bot) { await reply(text("scoreTransferBot")); return; }
    let member;
    try { member = await interaction.guild?.members.fetch({ user: recipient.id, force: true, cache: false }); }
    catch (error) {
      const missing = error && typeof error === "object" && "code" in error && error.code === 10007;
      await reply(text(missing ? "scoreTransferMemberOnly" : "scoreTransferUnavailable")); return;
    }
    if (!member || member.id !== recipient.id || member.guild.id !== guildId) { await reply(text("scoreTransferMemberOnly")); return; }
    const result = await transferSparks(interaction.id, guildId, interaction.user.id, recipient.id, amount);
    if (result.status === "invalid") { await reply(text("scoreTransferInvalid")); return; }
    if (result.status === "self") { await reply(text("scoreTransferSelf")); return; }
    if (result.status === "insufficient") { await reply(text("scoreTransferInsufficient", { amount, balance: result.balance })); return; }
    if (result.status === "limit") { await reply(text("scoreTransferLimit")); return; }
    await reply(text("scoreTransferDone", { amount: result.receipt.amount, user: `<@${recipient.id}>` }));
    return;
  }
  if (sub === "exchange") {
    const amount = interaction.options.getInteger("amount", true);
    const result = await exchangeSparks(interaction.id, guildId, interaction.user.id, amount);
    if (result.status === "invalid") { await reply(text("scoreExchangeInvalid", { min: minExchangeSparks, max: maxExchangeSparks })); return; }
    if (result.status === "insufficient") { await reply(text("scoreExchangeInsufficient", { amount, balance: result.balance })); return; }
    if (result.status === "limit") { await reply(text("scoreExchangeLimit")); return; }
    const receipt = result.receipt;
    await reply(text(receipt.levelReward ? "scoreExchangeLevelUp" : "scoreExchangeDone", {
      amount: receipt.sparksSpent, exp: receipt.expGained, balance: receipt.sparksAfter,
      level: receipt.levelAfter, reward: receipt.levelReward
    }));
    return;
  }
  if (sub === "badge") {
    const choices = badgeOptionNames.map((name, index) => interaction.options.getString(name, index === 0));
    const ids = choices.filter((id): id is string => id !== null && id !== "none");
    if ((choices[0] === "none" && ids.length) || ids.length > maxDisplayedBadges || new Set(ids).size !== ids.length) {
      await reply(text("badgeSelectionInvalid")); return;
    }
    if (choices[0] === "none") {
      await db.userScore.updateMany({ where: { guildId, userId: interaction.user.id }, data: { selectedBadge: null } });
      await reply(text("badgeCleared"));
      return;
    }
    if (!ids.length || !ids.every(isAchievementId)) { await reply(text("badgeUnknown")); return; }
    const wallet = await db.userScore.findUnique({ where: { guildId_userId: { guildId, userId: interaction.user.id } }, select: { bonusExp: true } });
    const requirements = ids.map(id => achievementRequirement(id, wallet?.bonusExp)!);
    const saved = await db.userScore.updateMany({ where: { guildId, userId: interaction.user.id, AND: requirements },
      data: { selectedBadge: encodeSelectedBadges(ids) } });
    if (!saved.count) { await reply(text("badgeLocked")); return; }
    const progress = achievementProgress(null);
    await reply(text("badgeSet", { badge: bulletList(ids.map(id => inlineText(text(progress.find(item => item.id === id)!.name)))) }));
    return;
  }
  if (sub === "leaderboard") {
    const players = await db.userScore.findMany({ where: { guildId, answered: { gt: 0 } },
      orderBy: [{ points: "desc" }, { correct: "desc" }, { userId: "asc" }], take: 10 });
    const description = players.length ? players.map((player, i) => {
      const rank = rankMarkers[i] ?? `**${i + 1}.**`;
      const progress = experienceProgress(player.points, player.bonusExp);
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
  const displayName = (interaction.guild?.members.cache.get(user.id)?.displayName
    ?? user.displayName ?? user.username ?? text("scorePlayer")).replace(/[\r\n]+/g, " ");
  const badges = selectedAchievements(player);
  if (sub === "achievements") {
    const progress = achievementProgress(player);
    const embed = new EmbedBuilder().setColor(0xad94f3)
      .setTitle(boundedText(text("achievementsTitle", { user: displayName }), 250))
      .setDescription(text("achievementsSummary", { unlocked: progress.filter(item => item.unlocked).length, total: progress.length }))
      .addFields(progress.map(item => ({
        name: `${item.unlocked ? "✦" : "◇"} ${text(item.name)}`,
        value: `${text(item.goal)}\n${item.current} / ${item.target} · ${text(item.unlocked ? "achievementUnlocked" : "achievementLocked")}${badges.some(badge => badge.id === item.id) ? ` · ${text("achievementSelected")}` : ""}`,
        inline: false
      })));
    await reply({ content: null, embeds: [embed] });
    return;
  }
  const answered = player?.answered ?? 0;
  const correct = player?.correct ?? 0;
  const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const progress = experienceProgress(player?.points ?? 0, player?.bonusExp);
  const rank = await serverRank(guildId, user.id, player);
  const title = displayName;
  const rankLabel = rank === null ? text("scoreUnranked") : text("scoreRank", { rank });
  const avatar = avatarUrl(user);
  const cardData = {
    title, level: text("scoreLevel", { level: progress.level }),
    rank,
    badges: badges.map(badge => ({ id: badge.id, name: text(badge.name) })),
    points: text("scorePoints", { points: player?.points ?? 0 }).replace(/\*\*/g, ""),
    sparksLabel: text("sparksName"), sparks: String(player?.sparks ?? 0),
    experience: text("scoreExpProgress", { earned: progress.earned, required: progress.required }),
    percent: progress.percent,
    answersLabel: text("scoreAnswers"), answers: String(answered),
    correctLabel: text("scoreCorrect"), correct: `${correct} (${accuracy}%)`,
    streakLabel: text("scoreStreak"), streak: `${player?.currentStreak ?? 0} / ${player?.bestStreak ?? 0}`
  };
  let card: Buffer | undefined;
  try { card = await renderScoreCard(cardData, avatar); }
  catch { }
  if (card) {
    const alt = `${boundedText(title, 250)}\n${cardData.level} · ${cardData.points}\n${cardData.sparksLabel}: ${cardData.sparks}\n${rankLabel}\n${cardData.experience} (${progress.percent}%)\n${cardData.answersLabel}: ${answered}\n${cardData.correctLabel}: ${cardData.correct}\n${cardData.streakLabel}: ${cardData.streak}${cardData.badges.length ? `\n${text("scoreBadge", { badge: cardData.badges.map(badge => badge.name).join(", ") })}` : ""}`;
    const attachment = new AttachmentBuilder(card, { name: "quiz-profile.png", description: boundedText(alt, 1000) });
    await reply({ content: null, embeds: [new EmbedBuilder().setColor(0xad94f3).setImage("attachment://quiz-profile.png")], files: [attachment] });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0xad94f3)
    .setTitle(boundedText(title, 250))
    .setDescription(`**${cardData.level}** · ${rank === null ? rankLabel : `#${rank}`}\n${text("scorePoints", { points: player?.points ?? 0 })}\n${cardData.experience}\n${progressBar(progress.percent)}`)
    .addFields(
      { name: `✦ ${cardData.sparksLabel}`, value: cardData.sparks, inline: true },
      { name: `📚 ${text("scoreAnswers")}`, value: String(answered), inline: true },
      { name: `✅ ${text("scoreCorrect")}`, value: cardData.correct, inline: true },
      { name: `🔥 ${text("scoreStreak")}`, value: `${player?.currentStreak ?? 0} / ${player?.bestStreak ?? 0}`, inline: true }
    );
  if (cardData.badges.length) embed.addFields({ name: text("badgesSelected"), value: cardData.badges.map(badge => badge.name).join(", "), inline: false });
  if (avatar) embed.setThumbnail(avatar);
  await reply({
    content: null,
    embeds: [embed]
  });
}

export async function handleScoreAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (!interaction.guildId || interaction.options.getSubcommand() !== "set" || !badgeOptionNames.some(name => name === focused.name)) {
    await interaction.respond([]);
    return;
  }
  const [settings, player] = await Promise.all([
    getGuildSettings(interaction.guildId),
    db.userScore.findUnique({ where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } } })
  ]);
  const language = normalizeLanguage(settings?.language ?? interaction.locale);
  const search = String(focused.value).toLocaleLowerCase();
  const otherChoices = badgeOptionNames.filter(name => name !== focused.name).map(name => interaction.options.getString(name));
  const choices = [{ name: message(language, "badgeNone"), value: "none" },
    ...achievementProgress(player).filter(item => item.unlocked && !otherChoices.includes(item.id))
      .map(item => ({ name: message(language, item.name), value: item.id }))];
  await interaction.respond(choices.filter(item => item.name.toLocaleLowerCase().includes(search) || item.value.includes(search)).slice(0, 25));
}
