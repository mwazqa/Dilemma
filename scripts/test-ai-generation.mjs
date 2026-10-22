import assert from "node:assert/strict";

Object.assign(process.env, {
  DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test",
  OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-6-luna", OPENAI_REASONING_EFFORT: "low", AI_GENERATION_TIMEOUT_MS: "1000",
  AI_MAX_OUTPUT_TOKENS: "2048",
  AI_MIN_INTERVAL_MS: "0", AI_MAX_RETRIES: "1"
});
const question = { language: "pl", topic: "geografia", question: "Stolica Polski?", options: ["🏙️ Warszawa", "Krakow"], topicEmoji: "", optionEmojis: ["", ""], correctOption: 0, explanation: "Warszawa jest stolica Polski." };
let answerOptions = question.options;
let calls = 0;
let mode = "success";
let expectedLanguage = "pl";
let responseLanguage = "pl";
let lastInstructions;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  const body = JSON.parse(options.body);
  lastInstructions = body.instructions;
  assert.ok(lastInstructions.includes(`(${expectedLanguage})`));
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "low");
  assert.equal(body.max_output_tokens, 2048);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.text.format.schema.properties.language.enum, [expectedLanguage]);
  assert.ok(body.text.format.schema.required.includes("correctOption"));
  assert.equal(body.text.format.schema.properties.options.minItems, body.text.format.schema.properties.options.maxItems);
  if (mode === "hang") {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new DOMException("Aborted", "AbortError"));
      if (options.signal.aborted) fail();
      else options.signal.addEventListener("abort", fail, { once: true });
    });
  }
  const language = mode === "wrong-once" ? "pl" : responseLanguage;
  if (mode === "wrong-once") mode = "success";
  const text = JSON.stringify({ ...question, language, options: answerOptions, optionEmojis: answerOptions.map(() => "") });
  const payload = { object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
};
const { generateQuestion, AiGenerationTimeoutError, AiLanguageMismatchError, AiAnswerOptionsMismatchError } = await import("../dist/services/question-generator.js");
assert.equal((await generateQuestion("geography", "pl", [], 2)).options[0], "Warszawa");
mode = "hang";
expectedLanguage = "en";
const started = Date.now();
const outcomes = await Promise.allSettled([generateQuestion("first"), generateQuestion("queued", "en", [], 4, [], AbortSignal.timeout(500))]);
assert.ok(outcomes.every(result => result.status === "rejected" && result.reason instanceof AiGenerationTimeoutError));
assert.ok(Date.now() - started < 2000, "Queue must honor overall deadline");
assert.equal(calls, 2, "No hidden SDK retries or request after queue deadline");
mode = "success";
responseLanguage = "en";
await generateQuestion("after timeout", "en", [], 2);
answerOptions = ["Yes", "No"];
for (const language of ["en", "pl", "de", "es", "fr", "ja"]) {
  expectedLanguage = responseLanguage = language;
  const result = await generateQuestion("Historia Polski", language, ["Yes", "No"], 2, ["Stolica Polski?"]);
  assert.equal(result.language, language);
  assert.match(lastInstructions, /Their language must never change the output language/);
  assert.match(lastInstructions, /custom answer options must remain unchanged/);
}
expectedLanguage = responseLanguage = "ja";
mode = "wrong-once";
const beforeRetry = calls;
assert.equal((await generateQuestion("Polish topic", "ja", [], 2)).language, "ja");
assert.equal(calls, beforeRetry + 2, "Wrong response language is retried");
responseLanguage = "pl";
const beforeFailure = calls;
await assert.rejects(generateQuestion("Polish topic", "ja", [], 2), AiLanguageMismatchError);
assert.equal(calls, beforeFailure + 2, "Repeated wrong language fails within retry budget");
responseLanguage = "ja";
const beforeCountFailure = calls;
await assert.rejects(generateQuestion("Topic", "ja", [], 4), AiAnswerOptionsMismatchError);
assert.equal(calls, beforeCountFailure + 2);
await assert.rejects(generateQuestion("Topic", "ja", ["No", "Yes"], 2), AiAnswerOptionsMismatchError);
answerOptions = ["🍎 Apple", "Pear"];
assert.deepEqual((await generateQuestion("Fruit", "ja", answerOptions, 2)).options, answerOptions);
console.log("PASS: OpenAI strict schema, six locales, language and answer validation, JSON normalization, timeout and queue recovery");
