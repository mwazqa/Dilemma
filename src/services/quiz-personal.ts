import { ActionRowBuilder, ButtonBuilder, ButtonStyle, messageLink } from "discord.js";
import { db } from "../db.js";
import { inlineText } from "../formatting.js";
import { message } from "../messages.js";
import { MY_QUIZ_BUTTON_ID } from "./poll-controls.js";
import { storedQuizOptions } from "./quiz-options.js";
import { WITHDRAW_COST } from "./quiz-voting.js";

export function personalQuizAction(customId: string, sourceMessageId: string) {
  if (customId === MY_QUIZ_BUTTON_ID) return { messageId: sourceMessageId, action: "view", answerId: null };
  const match = /^quiz:me:([a-zA-Z0-9_-]{1,80}):(view|withdraw|wager|vote:([1-4]))$/.exec(customId);
  return match ? { messageId: match[1], action: match[2], answerId: match[3] ? Number(match[3]) : null } : null;
}

export async function quizPersonalPayload(identity: { messageId: string; guildId: string; channelId: string }, userId: string,
  language: string, notice?: string) {
  const quiz = await db.quizSettlement.findUnique({ where: { messageId: identity.messageId } });
  if (!quiz || quiz.guildId !== identity.guildId || quiz.channelId !== identity.channelId) return null;
  const poll = await db.generatedPoll.findUnique({ where: { messageId: identity.messageId } })
    ?? await db.randomPoll.findUnique({ where: { messageId: identity.messageId } });
  if (!poll || poll.guildId !== identity.guildId || poll.channelId !== identity.channelId) return null;
  const options = storedQuizOptions(poll.options);
  const ids = quiz.answerIds.split(",").map(Number);
  if (options.length !== ids.length) return null;
  const key = { messageId_userId: { messageId: identity.messageId, userId } };
  const [vote, answer, support, wager] = await Promise.all([
    db.quizVote.findUnique({ where: key }), db.quizAnswer.findUnique({ where: key }),
    db.quizSupport.findUnique({ where: key }), db.quizWager.findUnique({ where: key })
  ]);
  const active = quiz.votingMode === "buttons" && !quiz.scoredAt && !quiz.closedAt && +quiz.expiresAt > Date.now();
  const selected = (quiz.scoredAt ? answer?.answerId : vote?.answerId) ?? null;
  const describe = (id: number) => {
    const index = ids.indexOf(id);
    return `${index + 1}. ${inlineText(options[index] ?? "-")}`;
  };
  const lines = [notice ?? message(language, active ? "quizPersonalHeading" : quiz.scoredAt ? "quizResultHeading" : "quizResultPending"),
    `**${inlineText(poll.question)}**`, message(language, selected === null ? "quizNoChoice" : "quizChosenAnswer", { answer: selected === null ? "" : describe(selected) })];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (active) {
    if (notice) lines.push(message(language, "quizPersonalHeading"));
    const remaining = support?.hintAnswerIds ? support.hintAnswerIds.split(",").map(Number) : ids;
    if (support?.hintAnswerIds) {
      lines.push(message(language, "quizHintActive"));
      if (selected !== null && !remaining.includes(selected)) lines.push(message(language, "quizHintChoiceEliminated"));
    }
    if (wager) lines.push(message(language, "quizActiveWager", { stake: wager.amount, payout: wager.amount * 2 }));
    const answers = new ActionRowBuilder<ButtonBuilder>().addComponents(ids.flatMap((id, index) => remaining.includes(id)
      ? [new ButtonBuilder().setCustomId(`${MY_QUIZ_BUTTON_ID}:${quiz.messageId}:vote:${id}`)
        .setLabel(`${index + 1}. ${options[index]}`).setStyle(selected === id ? ButtonStyle.Success : ButtonStyle.Primary)] : []));
    components.push(answers);
  } else if (quiz.scoredAt) {
    lines.push(message(language, "quizCorrectAnswer", { answer: describe(quiz.correctAnswerId) }));
    if (answer) lines.push(message(language, answer.correct ? "quizAnswerWon" : "quizAnswerLost", { points: answer.points }));
    if (wager?.payout !== null && wager?.payout !== undefined) {
      const net = wager.payout - wager.amount;
      lines.push(message(language, "quizWagerResult", { stake: wager.amount, payout: wager.payout, net: `${net > 0 ? "+" : ""}${net}` }));
    } else lines.push(message(language, "quizNoWager"));
  }
  const controls = new ActionRowBuilder<ButtonBuilder>();
  if (active) controls.addComponents(
    new ButtonBuilder().setCustomId(`${MY_QUIZ_BUTTON_ID}:${quiz.messageId}:withdraw`)
      .setLabel(message(language, "withdrawVoteButton", { cost: WITHDRAW_COST })).setStyle(ButtonStyle.Secondary).setDisabled(selected === null),
    new ButtonBuilder().setCustomId(`${MY_QUIZ_BUTTON_ID}:${quiz.messageId}:wager`)
      .setLabel(message(language, "wagerButton")).setStyle(ButtonStyle.Secondary).setDisabled(selected === null || Boolean(wager))
  );
  controls.addComponents(
    new ButtonBuilder().setCustomId(`${MY_QUIZ_BUTTON_ID}:${quiz.messageId}:view`)
      .setLabel(message(language, "quizRefreshButton")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel(message(language, "quizJumpButton")).setStyle(ButtonStyle.Link)
      .setURL(messageLink(quiz.channelId, quiz.messageId, quiz.guildId))
  );
  components.push(controls);
  return { content: lines.join("\n\n"), components };
}
