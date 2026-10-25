import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder, type ChatInputCommandInteraction, type MessageComponentInteraction
} from "discord.js";
import { db } from "../db.js";
import { parseDifficulty } from "../difficulty.js";
import { rememberLanguage } from "../feedback.js";
import { inlineText } from "../formatting.js";
import { message, normalizeLanguage } from "../messages.js";
import { getGuildSettings } from "../services/guild-settings.js";
import { canManageDilemma } from "../services/management-permissions.js";
import { guildTimezone } from "../services/timezone.js";

export const TOPIC_LIST_PREFIX = "topic-list:";
const pageSize = 5;
const statuses = ["all", "enabled", "disabled"] as const;
const difficulties = ["all", "easy", "medium", "hard"] as const;
const actions = ["status", "difficulty", "channel", "previous", "next", "refresh", "reset"] as const;
type ListState = { owner: string; status: typeof statuses[number]; difficulty: typeof difficulties[number]; channel: string; page: number };
type ListAction = typeof actions[number];
type ListTopic = {
  id: string; name: string; enabled: boolean; channelId: string | null; startDate: string | null;
  generationTime: string | null; intervalDays: number;
  pollDurationHours: number; difficulty: string; optionCount: number;
  pingRoleId?: string | null;
};

function componentId(state: ListState, action: ListAction): string {
  return `${TOPIC_LIST_PREFIX}${state.owner}:${state.status}:${state.difficulty}:${state.channel}:${state.page}:${action}`;
}

function parseState(value: string): { state: ListState; action: ListAction } | null {
  const parts = value.split(":");
  if (parts.length !== 7 || parts[0] !== "topic-list") return null;
  const [, owner, status, difficulty, channel, page, action] = parts;
  if (!/^\d{17,20}$/.test(owner) || !statuses.includes(status as ListState["status"]) ||
    !difficulties.includes(difficulty as ListState["difficulty"]) || !/^(?:all|\d{17,20})$/.test(channel) ||
    !/^\d{1,7}$/.test(page) || !actions.includes(action as ListAction)) return null;
  return { state: { owner, status: status as ListState["status"], difficulty: difficulty as ListState["difficulty"],
    channel, page: Number(page) }, action: action as ListAction };
}

export function topicListView(topics: ListTopic[], state: ListState, language: string, timezone: string) {
  const text = (key: Parameters<typeof message>[1], values?: Record<string, string | number>) => message(language, key, values);
  const collator = new Intl.Collator(normalizeLanguage(language), { sensitivity: "base", numeric: true });
  const rows = topics.filter(topic => (state.status === "all" || topic.enabled === (state.status === "enabled")) &&
    (state.difficulty === "all" || parseDifficulty(topic.difficulty) === state.difficulty) &&
    (state.channel === "all" || topic.channelId === state.channel)).map(topic => ({ topic, date: topic.startDate ?? null }))
    .sort((first, second) => {
      const a = first.date ?? "9999-99-99", b = second.date ?? "9999-99-99";
      return (a < b ? -1 : a > b ? 1 : 0) || collator.compare(first.topic.name, second.topic.name) ||
        (first.topic.id < second.topic.id ? -1 : first.topic.id > second.topic.id ? 1 : 0);
    });
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state = { ...state, page: Math.min(Math.max(0, state.page), pages - 1) };
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle(text("topicListTitle"))
    .setDescription(rows.length ? text("topicListOrder") : topics.length ? text("topicListNoMatches") : text("emptyTopics"))
    .setFooter({ text: text("topicListPage", { page: state.page + 1, pages, count: rows.length, total: topics.length, timezone }) });
  for (const { topic, date } of rows.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
    embed.addFields({ name: `${date ?? text("topicListNoDate")} | ${inlineText(topic.name)}`,
      value: text("topicListDetails", { channel: topic.channelId ? `<#${topic.channelId}>` : text("scheduleUnset"),
        state: text(topic.enabled ? "enabled" : "disabled"), difficulty: text(parseDifficulty(topic.difficulty)),
        time: topic.generationTime ?? text("manualPublication"),
        days: topic.intervalDays, hours: topic.pollDurationHours, count: topic.optionCount }) +
        `\n- ${text("quizPingSummary", { role: topic.pingRoleId ? `<@&${topic.pingRoleId}>` : text("disabled") })}`, inline: false });
  }
  const status = new StringSelectMenuBuilder().setCustomId(componentId(state, "status")).setPlaceholder(text("topicListStatus"))
    .addOptions(statuses.map(value => ({ label: text(value === "all" ? "topicListAllStatuses" : value),
      value, default: state.status === value })));
  const difficulty = new StringSelectMenuBuilder().setCustomId(componentId(state, "difficulty")).setPlaceholder(text("topicListDifficulty"))
    .addOptions(difficulties.map(value => ({ label: text(value === "all" ? "topicListAllDifficulties" : value),
      value, default: state.difficulty === value })));
  const channel = new ChannelSelectMenuBuilder().setCustomId(componentId(state, "channel"))
    .setPlaceholder(text("topicListChannel")).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0).setMaxValues(1);
  if (state.channel !== "all") channel.setDefaultChannels(state.channel);
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(componentId(state, "previous")).setLabel(text("topicListPrevious"))
      .setStyle(ButtonStyle.Secondary).setDisabled(state.page === 0),
    new ButtonBuilder().setCustomId(componentId(state, "next")).setLabel(text("topicListNext"))
      .setStyle(ButtonStyle.Secondary).setDisabled(state.page === pages - 1),
    new ButtonBuilder().setCustomId(componentId(state, "refresh")).setLabel(text("topicListRefresh")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(componentId(state, "reset")).setLabel(text("topicListReset"))
      .setStyle(ButtonStyle.Secondary).setDisabled(state.status === "all" && state.difficulty === "all" && state.channel === "all")
  );
  return { content: null, embeds: [embed], allowedMentions: { parse: [] as const }, components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(status),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(difficulty),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channel), navigation
  ] };
}

async function listPayload(guildId: string, state: ListState, language: string, timezone: string) {
  const topics = await db.topic.findMany({ where: { guildId }, select: {
    id: true, name: true, enabled: true, channelId: true, startDate: true, generationTime: true,
    intervalDays: true, pollDurationHours: true, difficulty: true, optionCount: true, pingRoleId: true
  } });
  return topicListView(topics, state, language, timezone);
}

export async function showTopicList(interaction: ChatInputCommandInteraction, language: string, timezone: string) {
  await interaction.editReply(await listPayload(interaction.guildId!, {
    owner: interaction.user.id, status: "all", difficulty: "all", channel: "all", page: 0
  }, language, timezone));
}

export async function handleTopicListComponent(interaction: MessageComponentInteraction) {
  const parsed = parseState(interaction.customId);
  if (!interaction.guildId || !parsed || parsed.state.owner !== interaction.user.id ||
    interaction.message.author.id !== interaction.client.user.id) {
    await interaction.reply({ content: message(interaction.locale, "topicListInvalid"), flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] } });
    return;
  }
  await interaction.deferUpdate();
  const settings = await getGuildSettings(interaction.guildId);
  const language = normalizeLanguage(settings?.language ?? interaction.locale);
  rememberLanguage(interaction, language);
  if (!canManageDilemma(interaction, settings)) {
    await interaction.editReply({ content: message(language, "permission"), embeds: [], components: [], allowedMentions: { parse: [] } });
    return;
  }
  let { state } = parsed;
  const { action } = parsed;
  let valid = true;
  if (action === "status" || action === "difficulty") {
    const choices: readonly string[] = action === "status" ? statuses : difficulties;
    valid = interaction.isStringSelectMenu() && interaction.values.length === 1 && choices.includes(interaction.values[0]);
    if (valid && interaction.isStringSelectMenu()) state = { ...state, [action]: interaction.values[0], page: 0 };
  } else if (action === "channel") {
    valid = interaction.isChannelSelectMenu() && interaction.values.length <= 1 &&
      interaction.values.every(value => /^\d{17,20}$/.test(value));
    if (valid && interaction.isChannelSelectMenu()) state = { ...state, channel: interaction.values[0] ?? "all", page: 0 };
  } else {
    valid = interaction.isButton();
    if (action === "reset") state = { ...state, status: "all", difficulty: "all", channel: "all", page: 0 };
    if (action === "previous") state = { ...state, page: Math.max(0, state.page - 1) };
    if (action === "next") state = { ...state, page: state.page + 1 };
  }
  if (!valid) {
    await interaction.followUp({ content: message(language, "topicListInvalid"), flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] } });
    return;
  }
  await interaction.editReply(await listPayload(interaction.guildId, state, language, guildTimezone(settings)));
}
