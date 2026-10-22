import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test",
  OPENROUTER_MODEL: "nvidia/nemotron-3-super-120b-a12b:free", AI_MAX_RETRIES: "0", AI_MIN_INTERVAL_MS: "0",
  AI_MODEL_TIMEOUT_MS: "1000", AI_GENERATION_TIMEOUT_MS: "5000" });
delete process.env.OPENROUTER_FALLBACK_MODELS;
const fixture = { language: "pl", topic: "Kosmos", question: "Która planeta jest największa?", options: ["Jowisz", "Mars", "Ziemia", "Wenus"],
  correctOption: 0, explanation: "Jowisz jest największą planetą Układu Słonecznego.", topicEmoji: "", optionEmojis: ["", "", "", ""] };
let actions = [], requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (_, options) => {
  const body = JSON.parse(options.body);
  requests.push(body.model);
  assert.ok(body.model.endsWith(":free"));
  assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.reasoning.enabled, false);
  const action = actions.shift() ?? {};
  if (action.hang) return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  });
  const payload = action.status ? { error: { message: "Fixture provider failure" } } : { choices: [{ message: {
    content: action.content ?? JSON.stringify({ ...fixture, ...action.question }) } }] };
  return new Response(JSON.stringify(payload), { status: action.status ?? 200, headers: { "content-type": "application/json" } });
};
const { env } = await import("../dist/config.js");
const { generateQuestion, AiGenerationError, AiGenerationTimeoutError } = await import("../dist/services/question-generator.js");
const models = [env.OPENROUTER_MODEL, ...env.OPENROUTER_FALLBACK_MODELS];
const reset = values => { actions = values; requests = []; };
const generate = signal => generateQuestion("Kosmos", "pl", [], 4, [], signal);
try {
  assert.equal(new Set(models).size, 4);
  for (const status of [404, 408, 409, 429, 500, 503]) {
    reset([{ status }, {}]);
    assert.equal((await generate()).language, "pl");
    assert.deepEqual(requests, models.slice(0, 2));
  }
  reset([{ status: 404 }, { status: 503 }, { status: 429 }, {}]);
  await generate(); assert.deepEqual(requests, models);
  for (const [status, kind] of [[401, "configuration"], [403, "configuration"], [402, "limit"], [400, "unavailable"]]) {
    reset([{ status }]);
    await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === kind);
    assert.equal(requests.length, 1, "Account and invalid-request errors never bypass access settings");
  }
  for (const invalid of [{ content: "" }, { content: "{broken}" }, { question: { language: "en" } },
    { question: { options: ["A", "B"] } }, { question: { correctOption: 7 } }]) {
    reset([invalid, {}]); await generate(); assert.deepEqual(requests, models.slice(0, 2));
  }
  reset([{ question: { options: [...fixture.options].reverse() } }, {}]);
  assert.deepEqual((await generateQuestion("Kosmos", "pl", fixture.options, 4)).options, fixture.options);
  assert.equal(requests.length, 2);
  reset([{ hang: true }, {}]);
  const started = Date.now(); await generate();
  assert.equal(requests.length, 2); assert.ok(Date.now() - started < 2500);
  reset([{ hang: true }]);
  await assert.rejects(generate(AbortSignal.timeout(80)), AiGenerationTimeoutError);
  assert.equal(requests.length, 1, "Overall deadline prevents further attempts");
  reset([{ hang: true }, {}]);
  const queued = await Promise.allSettled([generate(), generate(AbortSignal.timeout(50))]);
  assert.equal(queued[0].status, "fulfilled");
  assert.ok(queued[1].status === "rejected" && queued[1].reason instanceof AiGenerationTimeoutError);
  assert.equal(requests.length, 2, "Expired queued requests never contact a provider");
  reset(models.map(() => ({ status: 404 })));
  await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === "unavailable");
  assert.deepEqual(requests, models);
  env.AI_MAX_RETRIES = 1;
  reset([...models.map(() => ({ status: 404 })), {}]);
  await generate(); assert.equal(requests.length, models.length + 1);
  env.OPENROUTER_MODEL = env.OPENROUTER_FALLBACK_MODELS[0]; env.AI_MAX_RETRIES = 0;
  reset(models.map(() => ({ status: 404 })));
  await assert.rejects(generate(), AiGenerationError);
  assert.equal(requests.length, 3, "Primary and fallback duplicates are attempted only once");
  for (const value of ["openai/paid-model", "openrouter/auto", "vendor/model:free,vendor/paid", "a/a:free,b/b:free,c/c:free,d/d:free"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./dist/config.js')"], {
      env: { ...process.env, OPENROUTER_FALLBACK_MODELS: value }, encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.notEqual(child.status, 0, "Paid, automatic and oversized fallback lists are rejected");
  }
  console.log(JSON.stringify({ check: "ai-fallback", passed: true, orderedFreeModels: true, priceCeiling: true,
    providerFailures: true, validationFailures: true, boundedRetries: true, deadlines: true, noAccessBypass: true }));
} finally { globalThis.fetch = realFetch; }
