import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { privateErrorSummary } from "../dist/private-errors.js";
import { requireTestDatabase } from "./test-database-guard.mjs";

const marker = "FAKE_SECRET_MUST_NOT_APPEAR";
const error = new Error(`https://discord.com/api/interactions/example/${marker}`);
error.name = "DiscordAPIError[40060]";
error.requestBody = { authorization: marker };
assert.equal(privateErrorSummary(error), "DiscordAPIError");
error.name = marker;
assert.equal(privateErrorSummary(error), "Error");
assert.equal(privateErrorSummary({ token: marker }), "Unknown failure");

for (const statement of ["throw error", "Promise.reject(error)"]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `await import('./dist/private-errors.js'); const error = new Error('${marker}'); error.requestBody = { token: '${marker}' }; ${statement};`], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("Error"));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(marker), "Fatal output must omit secret-bearing error properties");
}
Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENROUTER_API_KEY: "test" });
const { db } = await import("../dist/db.js");
const { runDueTopics } = await import("../dist/scheduler.js");
db.topic.findMany = async () => [{ name: marker, channelId: "test", generationTime: "00:00", lastGeneratedAt: null, intervalDays: 1 }];
const originalConsoleError = console.error;
const messages = [];
try {
  console.error = (...args) => messages.push(args.join(" "));
  await runDueTopics({ channels: { fetch: async () => { throw error; } } });
} finally { console.error = originalConsoleError; }
assert.equal(messages.length, 1);
assert.ok(!messages.join(" ").includes(marker), "Scheduler must omit topic names and raw errors");
await db.$disconnect();

const registration = spawnSync(process.execPath, ["--input-type=module", "-e",
  `Object.assign(process.env, { DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: 'test' }); const { REST } = await import('discord.js'); REST.prototype.put = async () => { throw new Error('${marker}'); }; await import('./dist/register-commands.js');`], { encoding: "utf8" });
assert.equal(registration.status, 1);
assert.ok(!`${registration.stdout}${registration.stderr}`.includes(marker), "Registration errors must not use raw error output");

const testEnvironment = { DATABASE_URL: "postgresql://test:test@localhost/dilemma_test", EXPECTED_TEST_HOST: "localhost", EXPECTED_TEST_DATABASE: "dilemma_test", TEST_DATABASE_CONFIRMED: "true" };
assert.equal(requireTestDatabase(testEnvironment).hostname, "localhost");
for (const changes of [{ TEST_DATABASE_CONFIRMED: "false" }, { EXPECTED_TEST_HOST: "other.invalid" }, { EXPECTED_TEST_DATABASE: "other" }]) {
  assert.throws(() => requireTestDatabase({ ...testEnvironment, ...changes }));
}
console.log("PASS: private errors, scheduler, registration and explicit test-database guard");
