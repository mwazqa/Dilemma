import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { message, type MessageKey } from "../messages.js";
import { openFeedback } from "../feedback.js";

export function getHelpContent(language = "en"): string {
  const embed = getHelpEmbed(language).toJSON();
  return [embed.title, embed.description, ...(embed.fields ?? []).flatMap(field => [field.name, field.value])].filter(Boolean).join("\n");
}

export function getHelpEmbed(language = "en"): EmbedBuilder {
  const sections: { title: MessageKey; commands: [string, MessageKey][] }[] = [
    { title: "helpQuizzes", commands: [
      ["/dilemma random", "helpRandom"], ["/dilemma end", "helpPoll"]
    ] },
    { title: "helpPlayerProgress", commands: [
      ["/dilemma profile", "helpProfile"], ["/dilemma leaderboard", "helpLeaderboard"],
      ["/dilemma achievements", "helpAchievements"], ["/dilemma badges set", "helpBadge"]
    ] },
    { title: "helpSparks", commands: [
      ["/dilemma sparks exchange", "helpExchange"], ["/dilemma sparks transfer", "helpTransfer"]
    ] },
    { title: "helpTopics", commands: [
      ["/dilemma create", "helpCreate"], ["/dilemma edit", "helpConfigure"], ["/dilemma publish", "helpRun"],
      ["/dilemma list", "helpList"], ["/dilemma enable` / `/dilemma disable", "helpToggle"],
      ["/dilemma delete", "helpManage"]
    ] },
    { title: "helpSettings", commands: [["/dilemma language", "helpLanguage"], ["/dilemma timezone", "helpTimezone"],
      ["/dilemma random-cooldown-reset", "helpRandomReset"], ["/dilemma guide publish", "helpPlayerGuide"],
      ["/dilemma ping", "helpPing"]] },
    { title: "helpChannelsTitle", commands: [
      ["/dilemma random-channels add", "helpChannelsAdd"], ["/dilemma random-channels remove", "helpChannelsRemove"],
      ["/dilemma random-channels list", "helpChannelsList"],
      ["/dilemma random-notifications set", "helpRandomNotifications"],
      ["/dilemma random-notifications clear", "helpRandomNotifications"],
      ["/dilemma random-notifications show", "helpRandomNotifications"]
    ] },
    { title: "helpPermissionsTitle", commands: [
      ["/dilemma permissions show", "helpPermissionsShow"], ["/dilemma permissions set", "helpPermissionsSet"],
      ["/dilemma permissions clear", "helpPermissionsClear"]
    ] }
  ];
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(message(language, "helpIntro"))
    .addFields(sections.map(section => ({
      name: message(language, section.title),
      value: section.commands.map(([command, key]) => `- \`${command}\` - ${message(language, key)}`).join("\n"),
      inline: false
    })));
}

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  const { language, reply } = await openFeedback(interaction);
  await reply({ content: null, embeds: [getHelpEmbed(language)] });
}
