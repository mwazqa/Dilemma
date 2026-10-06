import assert from "node:assert/strict";

Object.assign(process.env, {
  DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", AI_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "test", AI_GENERATION_TIMEOUT_MS: "1000",
  OPENROUTER_MODEL: "nvidia/nemotron-3-super-120b-a12b:free",
  AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "1"
});
const question = { language: "pl", topic: "geografia", question: "Stolica Polski?", options: ["🏙️ Warszawa", "Krakow"], topicEmoji: "", optionEmojis: ["", ""], correctOption: 0, explanation: "Warszawa jest stolica Polski." };
let calls = 0;
let mode = "success";
globalThis.fetch = async (url, options) => {
  calls++;
  assert.match(String(url), /chat\/completions/);
  const body = JSON.parse(options.body);
  assert.equal(body.model, "nvidia/nemotron-3-super-120b-a12b:free");
  assert.equal(body.reasoning.enabled, false);
  assert.equal(body.response_format.type, "json_object");
  if (mode === "hang") {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new DOMException("Aborted", "AbortError"));
      if (options.signal.aborted) fail();
      else options.signal.addEventListener("abort", fail, { once: true });
    });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(question) } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const { generateQuestion, AiGenerationTimeoutError } = await import("../dist/services/question-generator.js");
assert.equal((await generateQuestion("geography", "pl", [], 2)).options[0], "Warszawa");
mode = "hang";
const started = Date.now();
const outcomes = await Promise.allSettled([generateQuestion("first"), generateQuestion("queued", "en", [], 4, [], AbortSignal.timeout(500))]);
assert.ok(outcomes.every(result => result.status === "rejected" && result.reason instanceof AiGenerationTimeoutError));
assert.ok(Date.now() - started < 2000, "Queue must honor overall deadline");
assert.equal(calls, 2, "No hidden SDK retries or request after queue deadline");
mode = "success";
await generateQuestion("after timeout");
console.log("PASS: JSON normalization, bounded request, bounded queue, queue recovery");
