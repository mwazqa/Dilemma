import assert from "node:assert/strict";
Object.assign(process.env, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { MessageFlags } = await import("discord.js");
const { inlineText, textPages } = await import("../dist/formatting.js");
const { openFeedback } = await import("../dist/feedback.js");
const { message, messageLanguages } = await import("../dist/messages.js");
const { getHelpEmbed } = await import("../dist/commands/help.js");
try {
  assert.equal(inlineText("**Quiz**\nNowy `temat`"), "\\*\\*Quiz\\*\\* Nowy \\`temat\\`");
  const blocks = Array.from({ length: 40 }, (_, i) => `**Temat ${i}**\n\n- Kanał: <#123>\n- ${"x".repeat(95)}`);
  const pages = textPages(blocks);
  assert.ok(pages.length > 1 && pages.every(page => page.length <= 2000));
  assert.equal(pages.join("\n\n"), blocks.join("\n\n"));
  const long = "x".repeat(1999) + "🌸" + "y".repeat(2000);
  const split = textPages([long]);
  assert.equal(split.join(""), long);
  assert.ok(split.every(page => page.length <= 2000 && !/[\uD800-\uDBFF]$/u.test(page) && !/^[\uDC00-\uDFFF]/u.test(page)));
  for (const limit of [0, 1, 2001, 2.5]) assert.throws(() => textPages(blocks, limit), RangeError);
  assert.deepEqual(textPages([]), []);
  const responses = [];
  const feedback = await openFeedback({ guildId: null, locale: "pl", deferReply: async payload => assert.equal(payload.flags, MessageFlags.Ephemeral),
    editReply: async payload => responses.push(payload), followUp: async payload => {
      assert.equal(payload.flags, MessageFlags.Ephemeral); responses.push(payload);
    } });
  await feedback.replyBlocks(blocks);
  assert.deepEqual(responses.map(item => item.content), pages);
  assert.ok(responses.every(item => item.allowedMentions.parse.length === 0));
  for (const language of messageLanguages) {
    const summary = message(language, "summary", { name: "Prawda czy absurd?", state: message(language, "enabled"), channel: "<#123>",
      start: "2026-11-01", time: "09:00 (Europe/Warsaw)", days: 7, hours: 15, difficulty: message(language, "hard"), answers: "AI: 2" });
    const created = message(language, "topicCreated", { summary });
    assert.ok(created.includes(`\n\n${summary}`));
    assert.equal(summary.split("\n").filter(line => line.startsWith("- ")).length, 8);
    assert.ok(summary.includes("<#123>") && summary.includes("2026-11-01"));
    assert.doesNotMatch(created, /<\/?(?:ul|ol|li)>|\{\w+\}/);
    const help = getHelpEmbed(language).toJSON();
    assert.ok(help.fields.every(field => field.value.length <= 1024 && field.value.split("\n").every(line => line.startsWith("- "))));
  }
  console.log(JSON.stringify({ check: "feedback-layout", passed: true, locales: 6, completePrivatePagination: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "feedback-layout", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-feedback-layout\.mjs:(\d+)/)?.[1] ?? 0) })); process.exitCode = 1;
}
