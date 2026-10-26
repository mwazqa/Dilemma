import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireTestDatabase } from "./test-database-guard.mjs";

requireTestDatabase(process.env);
const { db } = await import("../dist/db.js");
const { createTopic, MAX_TOPICS_PER_GUILD, TopicLimitError } = await import("../dist/services/topic-creation.js");
const prefix = `topic-limit-test-${randomUUID()}`;
const guilds = [`${prefix}-first`, `${prefix}-other`, `${prefix}-legacy`];
const data = (guildId, name, enabled = true) => ({ guildId, name, options: "", enabled });

try {
  assert.equal(MAX_TOPICS_PER_GUILD, 31);
  await db.topic.createMany({ data: Array.from({ length: 30 }, (_, index) => data(guilds[0], `Saved ${index}`, false)) });
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => createTopic(data(guilds[0], `Concurrent ${index}`))));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(attempts.filter(result => result.status === "rejected").every(result => result.reason instanceof TopicLimitError));
  assert.equal(await db.topic.count({ where: { guildId: guilds[0] } }), 31);
  const other = await createTopic(data(guilds[1], "Independent"));
  assert.equal(other.guildId, guilds[1]);
  await db.topic.delete({ where: { guildId_name: { guildId: guilds[0], name: "Saved 0" } } });
  await assert.rejects(createTopic(data(guilds[0], "Saved 1")), error => error.code === "P2002");
  assert.equal(await db.topic.count({ where: { guildId: guilds[0] } }), 30);
  await createTopic(data(guilds[0], "Replacement"));
  assert.equal(await db.topic.count({ where: { guildId: guilds[0] } }), 31);
  await db.topic.createMany({ data: Array.from({ length: 32 }, (_, index) => data(guilds[2], `Legacy ${index}`)) });
  await assert.rejects(createTopic(data(guilds[2], "Overflow")), TopicLimitError);
  const updated = await db.topic.update({ where: { guildId_name: { guildId: guilds[2], name: "Legacy 0" } }, data: { enabled: false } });
  assert.equal(updated.enabled, false);
  assert.equal(await db.topic.count({ where: { guildId: guilds[2] } }), 32);
  console.log(JSON.stringify({ check: "topic-limit-postgres", passed: true, limit: 31, concurrentClaims: true,
    disabledTopicsCounted: true, guildIsolation: true, deletionFreesSlot: true, duplicatePreservesSlot: true, legacyTopicsPreserved: true }));
} catch {
  console.error("Isolated topic limit test failed. Raw output withheld.");
  process.exitCode = 1;
} finally {
  await db.topic.deleteMany({ where: { guildId: { in: guilds } } });
  await db.$disconnect();
}
