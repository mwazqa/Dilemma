import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test",
  OPENROUTER_MODEL: "fixture/primary:free", OPENROUTER_FALLBACK_MODELS: "", OPENROUTER_DYNAMIC_FALLBACK: "true",
  AI_MAX_RETRIES: "0", AI_MIN_INTERVAL_MS: "0", AI_GENERATION_TIMEOUT_MS: "5000", AI_MODEL_TIMEOUT_MS: "1000" });
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
let catalogCalls = 0;
let catalogMode = "success";
const validModel = id => ({ id, pricing: { prompt: "0", completion: "0", request: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["response_format", "reasoning", "max_tokens"], context_length: 32768,
  reasoning: { mandatory: false }, expiration_date: null });
let entries = Array.from({ length: 6 }, (_, index) => validModel(`fixture/dynamic-${index}`));
const invalid = [
  { ...validModel("fixture/paid:free"), pricing: { prompt: "0", completion: "0.001" } },
  { ...validModel("fixture/fee:free"), pricing: { prompt: "0", completion: "0", request: "0.01" } },
  { ...validModel("fixture/missing:free"), pricing: { prompt: "0" } },
  { ...validModel("fixture/empty-price:free"), pricing: { prompt: "", completion: "0" } },
  { ...validModel("fixture/not-a-price:free"), pricing: { prompt: "NaN", completion: "0" } },
  { ...validModel("fixture/reasoning:free"), reasoning: { mandatory: true } },
  { ...validModel("fixture/no-json:free"), supported_parameters: ["reasoning", "max_tokens"] },
  { ...validModel("fixture/no-reasoning:free"), supported_parameters: ["response_format", "max_tokens"] },
  { ...validModel("fixture/small:free"), context_length: 4096 },
  { ...validModel("fixture/image:free"), architecture: { input_modalities: ["image"], output_modalities: ["image"] } },
  { ...validModel("fixture/expired:free"), expiration_date: "2000-01-01" },
  { ...validModel("fixture/bad-date:free"), expiration_date: "unknown" },
  validModel("openrouter/free"), validModel("fixture/unsafe\nmodel:free"), null
];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://openrouter.ai/api/v1/models/user");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, "Bearer test");
  catalogCalls++;
  if (catalogMode === "fail") throw new Error("Fixture private catalog details");
  if (catalogMode === "slow") await delay(120);
  if (catalogMode === "hang") await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  const payload = catalogMode === "malformed" ? { data: {} } : { data: [...entries, ...invalid, entries[0]] };
  return new Response(JSON.stringify(payload), { status: catalogMode === "forbidden" ? 403 : 200 });
};
const { discoverFreeModels } = await import("../dist/services/free-models.js?unit");
const signal = () => AbortSignal.timeout(5000);
const keepAlive = setInterval(() => {}, 1000);
try {
  assert.equal(catalogCalls, 0, "Importing the module never starts polling");
  const aborted = AbortSignal.abort();
  await assert.rejects(discoverFreeModels([], aborted)); assert.equal(catalogCalls, 0);
  const first = await Promise.all([discoverFreeModels([], signal()), discoverFreeModels([], signal())]);
  assert.equal(catalogCalls, 1, "Concurrent discovery shares one catalog request");
  assert.equal(new Set(first.flat()).size, 6, "Bounded batches rotate through the eligible pool");
  assert.ok(first.flat().every(id => /^fixture\/dynamic-\d$/.test(id)));
  const excluded = await discoverFreeModels(entries.slice(0, 5).map(model => model.id), signal());
  assert.deepEqual(excluded, [entries[5].id]); assert.equal(catalogCalls, 1);
  now += 6 * 60 * 60 * 1000 + 1;
  entries = [validModel("fixture/new-model:free")];
  assert.deepEqual(await discoverFreeModels([], signal()), [entries[0].id]); assert.equal(catalogCalls, 2);
  now += 6 * 60 * 60 * 1000 + 1;
  catalogMode = "fail";
  assert.deepEqual(await discoverFreeModels([], signal()), []);
  assert.deepEqual(await discoverFreeModels([], signal()), []); assert.equal(catalogCalls, 3);
  now += 30_001; catalogMode = "success";
  entries = [{ ...validModel("fixture/short-lived:free"), expiration_date: new Date(now + 1000).toISOString() }];
  assert.equal((await discoverFreeModels([], signal())).length, 1);
  now += 2000;
  assert.deepEqual(await discoverFreeModels([], signal()), [], "Cached models are excluded as soon as they expire");
  for (const mode of ["forbidden", "malformed"]) {
    catalogMode = mode;
    const fresh = await import(`../dist/services/free-models.js?${mode}`);
    assert.deepEqual(await fresh.discoverFreeModels([], signal()), [], "Catalog failures never use an unfiltered public catalog");
  }
  catalogMode = "slow"; entries = [validModel("fixture/shared:free")];
  const shared = await import("../dist/services/free-models.js?shared");
  const sharedResults = await Promise.allSettled([shared.discoverFreeModels([], AbortSignal.timeout(25)), shared.discoverFreeModels([], signal())]);
  assert.equal(sharedResults[0].status, "rejected"); assert.equal(sharedResults[1].status, "fulfilled");
  catalogMode = "hang";
  const hanging = await import("../dist/services/free-models.js?hang");
  const started = realNow();
  assert.deepEqual(await hanging.discoverFreeModels([], signal()), []);
  assert.ok(realNow() - started < 4000, "Catalog timeout is bounded independently");
  Date.now = realNow;
  catalogMode = "success";
  entries = Array.from({ length: 6 }, (_, index) => validModel(`fixture/rescue-${index}`));
  const catalogFetch = globalThis.fetch;
  let requests = [], mode = "primary-success";
  const question = { language: "pl", topic: "Test", question: "Pytanie?", options: ["A", "B", "C", "D"],
    correctOption: 0, explanation: "Fakt.", topicEmoji: "", optionEmojis: ["", "", "", ""] };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/models/user")) return catalogFetch(url, options);
    const body = JSON.parse(options.body); requests.push(body.model);
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
    assert.equal(body.provider.require_parameters, true); assert.equal(body.response_format.type, "json_object");
    let status = 200;
    if (mode === "forbidden") status = 403;
    else if (mode === "all-fail" || (mode === "rescue" && body.model === "fixture/primary:free")) status = 404;
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: JSON.stringify(question) } }] }
      : { error: { message: "Fixture private provider details" } }), { status, headers: { "content-type": "application/json" } });
  };
  const { generateQuestion, AiGenerationError } = await import("../dist/services/question-generator.js");
  const { env } = await import("../dist/config.js");
  const generate = () => generateQuestion("Test", "pl", [], 4);
  const before = catalogCalls;
  await generate(); assert.equal(catalogCalls, before, "Healthy primary never loads catalog");
  mode = "forbidden"; requests = [];
  await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === "configuration");
  assert.equal(catalogCalls, before); assert.equal(requests.length, 1);
  mode = "rescue"; requests = [];
  await generate(); assert.equal(catalogCalls, before + 1);
  assert.deepEqual(requests, ["fixture/primary:free", entries[0].id]);
  mode = "all-fail"; requests = [];
  await assert.rejects(generate(), AiGenerationError);
  assert.equal(requests.length, 4, "One primary plus at most three discovered candidates");
  assert.equal(catalogCalls, before + 1);
  env.OPENROUTER_DYNAMIC_FALLBACK = false; requests = [];
  await assert.rejects(generate(), AiGenerationError); assert.equal(requests.length, 1);
  assert.equal(catalogCalls, before + 1);
  console.log(JSON.stringify({ check: "ai-discovery", passed: true, freeOnly: true, privacyFiltered: true, lazyCatalog: true,
    boundedRotation: true, cacheExpiry: true, failedCatalogCooldown: true, sharedFetch: true, deadlines: true, noBackgroundPolling: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "ai-discovery", passed: false, category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-ai-discovery\.mjs:(\d+)/)?.[1] ?? 0) })); process.exitCode = 1;
} finally { clearInterval(keepAlive); Date.now = realNow; globalThis.fetch = realFetch; }
