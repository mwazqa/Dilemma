import OpenAI from "openai";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "../config.js";
import { questionSchema, type Question } from "../types/question.js";
import { dilemmaPrompt } from "../brand.js";

const isOpenRouter = env.AI_PROVIDER === "openrouter";
const apiKey = isOpenRouter ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
const client = apiKey
  ? new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: env.AI_GENERATION_TIMEOUT_MS,
      baseURL: isOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
      defaultHeaders: isOpenRouter
        ? { "HTTP-Referer": "https://github.com/mwazqa/Dilemma", "X-Title": "Dilemma" }
        : undefined
    })
  : null;

let lastRequestStartedAt = 0;
let requestQueue = Promise.resolve();

export class AiGenerationTimeoutError extends Error {
  constructor() {
    super("AI generation timed out. Please try again later.");
    this.name = "AiGenerationTimeoutError";
  }
}

async function withAiRateLimit<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const previous = requestQueue;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  requestQueue = previous.then(() => gate);
  try {
    await waitForQueue(previous, signal);
    const waitMs = Math.max(0, env.AI_MIN_INTERVAL_MS - (Date.now() - lastRequestStartedAt));
    if (waitMs > 0) await delay(waitMs, undefined, { signal });
    signal.throwIfAborted();
    lastRequestStartedAt = Date.now();
    return await operation();
  } finally {
    release();
  }
}

async function waitForQueue(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    previous.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function generateQuestion(
  topic: string,
  language = "en",
  allowedOptions: string[] = [],
  optionCount = 4,
  avoidQuestions: string[] = [],
  signal = AbortSignal.timeout(env.AI_GENERATION_TIMEOUT_MS)
): Promise<Question> {
  if (!client) throw new Error(isOpenRouter
    ? "OPENROUTER_API_KEY is not configured"
    : "OPENAI_API_KEY is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt <= env.AI_MAX_RETRIES; attempt += 1) {
    try {
      const prompt = dilemmaPrompt + " Create one accurate, inclusive multiple-choice quiz question about " + topic +
          " in " + language + ". " + (allowedOptions.length
            ? "Use exactly these answer options: " + allowedOptions.join(", ") + "."
            : "Create exactly " + optionCount + " suitable answer options.") +
          " The explanation must be one short, interesting fact only about the correct answer. " +
          "Return only JSON with language, topic, question, options, topicEmoji, optionEmojis, correctOption and explanation. " +
          "Each answer must be at most 55 characters. correctOption is a zero-based index into options. " +
          (avoidQuestions.length ? "Do not repeat these previous questions: " + avoidQuestions.join(" | ") + "." : "");
      const startedAt = Date.now();
      console.log(`AI generation started: provider=${env.AI_PROVIDER}, attempt=${attempt + 1}`);
      const output = await withAiRateLimit(async () => {
        if (isOpenRouter) {
          const response = await client.chat.completions.create({
            model: env.OPENROUTER_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1500,
            ...(env.OPENROUTER_MODEL.startsWith("google/gemma-4-") ? {
              reasoning: { enabled: false },
              response_format: { type: "json_object" as const }
            } : {})
          }, { signal });
          return response.choices[0]?.message.content ?? "";
        }
        const response = await client.responses.create({
          model: env.OPENAI_MODEL,
          input: prompt
        }, { signal });
        return response.output_text;
      }, signal);
      const question = questionSchema.parse(normalizeQuestion(parseJson(output)));
      console.log(`AI generation completed in ${Date.now() - startedAt}ms`);
      return question;
    } catch (error) {
      lastError = error;
      if (signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError) throw new AiGenerationTimeoutError();
      console.warn(`AI generation failed: attempt=${attempt + 1}, type=${error instanceof Error ? error.name : "unknown"}`);
      if (attempt >= env.AI_MAX_RETRIES || !isRetryableAiError(error)) throw error;
      try {
        await delay(Math.min(8_000, 1_000 * 2 ** attempt), undefined, { signal });
      } catch {
        throw new AiGenerationTimeoutError();
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
}

function isRetryableAiError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: number; code?: string; name?: string };
  const message = error instanceof Error ? error.message : "";
  return apiError.status === 408 || apiError.status === 409 || apiError.status === 429 ||
    (typeof apiError.status === "number" && apiError.status >= 500) ||
    apiError.code === "ECONNRESET" || apiError.code === "ETIMEDOUT" || apiError.name === "FetchError" ||
    apiError.name === "ZodError" || message.includes("AI response does not contain a JSON object") ||
    message.includes("Unexpected end of JSON input");
}

function parseJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? value;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("AI response does not contain a JSON object");
  return JSON.parse(fenced.slice(start, end + 1));
}

function normalizeQuestion(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const question = value as Record<string, unknown>;
  const options = Array.isArray(question.options) ? question.options.map((option) => removeLeadingEmoji(String(option))) : [];
  const rawCorrect = question.correctOption;
  const optionEmojis = Array.isArray(question.optionEmojis) && question.optionEmojis.length === options.length
    ? question.optionEmojis.map(String)
    : options.map(() => "");
  const topicEmoji = typeof question.topicEmoji === "string" && question.topicEmoji.trim()
    ? question.topicEmoji.trim()
    : "";
  if (typeof rawCorrect !== "string") return { ...question, options, topicEmoji, optionEmojis };

  const normalized = rawCorrect.trim();
  const letterIndex = /^[A-D]$/i.test(normalized) ? normalized.toUpperCase().charCodeAt(0) - 65 : -1;
  const numericIndex = /^\d+$/.test(normalized) ? Number(normalized) : -1;
  const textIndex = options.findIndex((option) => option.toLowerCase() === normalized.toLowerCase());
  const correctOption = letterIndex >= 0 ? letterIndex : numericIndex >= 0 ? numericIndex : textIndex;
  return { ...question, options, topicEmoji, optionEmojis, correctOption };
}

function removeLeadingEmoji(value: string): string {
  return value.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D)+\s*/u, "").trim();
}
