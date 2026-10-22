import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

Object.assign(process.env, { DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test",
  OPENAI_MODEL: "gpt-6-luna", OPENAI_REASONING_EFFORT: "low", AI_MAX_OUTPUT_TOKENS: "2048",
  AI_MAX_RETRIES: "1", AI_MIN_INTERVAL_MS: "0", AI_REQUEST_TIMEOUT_MS: "1000", AI_GENERATION_TIMEOUT_MS: "5000" });
const question = { language: "pl", topic: "Kosmos", question: "Która planeta jest największa?",
  options: ["Jowisz", "Mars", "Ziemia", "Wenus"], correctOption: 0,
  explanation: "Jowisz jest największą planetą Układu Słonecznego.", topicEmoji: "", optionEmojis: ["", "", "", ""] };
let actions = [], requests = [];
const realFetch = globalThis.fetch;
const keepAlive = setInterval(() => {}, 1000);
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  const body = JSON.parse(options.body);
  requests.push({ model: body.model, started: Date.now() });
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 2048);
  assert.equal(body.text.format.strict, true);
  const action = actions.shift() ?? {};
  if (action.abortBody) return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"object":"response",'));
    const abort = () => controller.error(new DOMException("Fixture interrupted response body", action.abortBody));
    if (action.immediate || options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  } }), { headers: { "content-type": "application/json" } });
  const payload = action.status ? { error: { message: "Fixture private error", code: action.code ?? null } } : {
    object: "response", status: "completed", output: [{ type: "message", role: "assistant",
      content: [{ type: "output_text", text: action.text ?? JSON.stringify({ ...question, ...action.question }) }] }]
  };
  return new Response(JSON.stringify(action.payload ?? payload), { status: action.status ?? 200,
    headers: { "content-type": "application/json", ...action.headers } });
};
const { env } = await import("../dist/config.js");
const { generateQuestion, AiGenerationError, AiGenerationTimeoutError } = await import("../dist/services/question-generator.js");
const reset = values => { actions = values; requests = []; };
const generate = signal => generateQuestion("Kosmos", "pl", [], 4, [], signal);
try {
  for (const status of [408, 409, 429, 500, 503]) {
    reset([{ status }, {}]); await generate(); assert.equal(requests.length, 2);
  }
  for (const [status, kind] of [[401, "configuration"], [403, "configuration"], [402, "limit"], [400, "unavailable"], [404, "unavailable"]]) {
    reset([{ status }]);
    await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === kind);
    assert.equal(requests.length, 1);
  }
  reset([{ status: 429, code: "insufficient_quota" }, {}]);
  await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === "limit");
  assert.equal(requests.length, 1, "An account quota cannot be bypassed by retrying");
  reset([{ status: 429, headers: { "retry-after": "120" } }, {}]);
  await assert.rejects(generate(AbortSignal.timeout(100)), AiGenerationTimeoutError);
  assert.equal(requests.length, 1, "Retry-After waits honor the overall deadline");
  for (const invalid of [{ text: "" }, { text: "{broken}" }, { question: { language: "en" } },
    { question: { options: ["A", "B"] } }, { question: { correctOption: 7 } }]) {
    reset([invalid, {}]); await generate(); assert.equal(requests.length, 2);
  }
  for (const payload of [
    { object: "response", status: "incomplete", output: [] },
    { object: "response", status: "failed", error: { code: "server_error" }, output: [] },
    { object: "response", status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Fixture refusal" }] }] }
  ]) {
    reset([{ payload }, {}]);
    await assert.rejects(generate(), error => error instanceof AiGenerationError && error.kind === "invalid-response");
    assert.equal(requests.length, 1, "Do not automatically spend again on refusals or incomplete output");
  }
  for (const name of ["AbortError", "TimeoutError"]) {
    reset([{ abortBody: name }, {}]); await generate(); assert.equal(requests.length, 2);
    reset([{ abortBody: name, immediate: true }, { abortBody: name, immediate: true }]);
    await assert.rejects(generate(), AiGenerationTimeoutError); assert.equal(requests.length, 2);
  }
  reset([{ abortBody: "AbortError" }, {}]);
  await assert.rejects(generate(AbortSignal.timeout(50)), AiGenerationTimeoutError);
  assert.equal(requests.length, 1);
  reset([{}]); await generate(); assert.equal(requests.length, 1, "Body cancellation releases the queue");
  reset([{ abortBody: "AbortError" }, {}, {}]);
  const queued = await Promise.allSettled([generate(), generate(AbortSignal.timeout(50))]);
  assert.equal(queued[0].status, "fulfilled");
  assert.ok(queued[1].status === "rejected" && queued[1].reason instanceof AiGenerationTimeoutError);
  assert.equal(requests.length, 2, "An expired queued request never reaches the provider");
  env.AI_MAX_RETRIES = 0;
  reset([{ status: 503 }, {}]); await assert.rejects(generate(), AiGenerationError);
  assert.equal(requests.length, 1);
  env.AI_MIN_INTERVAL_MS = 80;
  reset([{}, {}]); await Promise.all([generate(), generate()]);
  assert.ok(requests[1].started - requests[0].started >= 70);
  for (const value of ["0", "4097", "invalid"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./dist/config.js')"], {
      env: { ...process.env, AI_MAX_OUTPUT_TOKENS: value }, encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.notEqual(child.status, 0);
  }
  const noKey = spawnSync(process.execPath, ["--input-type=module", "-e",
    "const {generateQuestion,AiGenerationError}=await import('./dist/services/question-generator.js');try{await generateQuestion('fixture');process.exitCode=1}catch(e){process.exitCode=e instanceof AiGenerationError&&e.kind==='configuration'?0:1}"], {
    env: { ...process.env, OPENAI_API_KEY: "" }, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(noKey.status, 0);
  console.log(JSON.stringify({ check: "ai-errors", passed: true, fixedModel: true, boundedRetries: true,
    quotaStopsRetries: true, retryAfter: true, bodyTimeouts: true, deadlines: true, queueRecovery: true,
    refusals: true, outputLimit: true, missingKey: true }));
} catch (error) {
  console.error(JSON.stringify({ check: "ai-errors", passed: false,
    category: error instanceof assert.AssertionError ? "assertion" : "test-error",
    line: Number(error.stack?.match(/test-ai-errors\.mjs:(\d+)/)?.[1] ?? 0) }));
  process.exitCode = 1;
} finally { clearInterval(keepAlive); globalThis.fetch = realFetch; }
