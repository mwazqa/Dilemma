import OpenAI from "openai";
import { env } from "../config.js";
import { questionSchema, type Question } from "../types/question.js";
import { dilemmaPrompt } from "../brand.js";

const isOpenRouter = env.AI_PROVIDER === "openrouter";
const apiKey = isOpenRouter ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
const client = apiKey
  ? new OpenAI({
      apiKey,
      baseURL: isOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
      defaultHeaders: isOpenRouter
        ? { "HTTP-Referer": "https://github.com/mwazqa/Dylematic", "X-Title": "Dilemma" }
        : undefined
    })
  : null;

let lastRequestStartedAt = 0;
let requestQueue = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAiRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const previous = requestQueue;
  let release!: () => void;
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, env.AI_MIN_INTERVAL_MS - (Date.now() - lastRequestStartedAt));
    if (waitMs > 0) await sleep(waitMs);
    lastRequestStartedAt = Date.now();
    return await operation();
  } finally {
    release();
  }
}

export async function generateQuestion(topic: string, language = "en", allowedOptions: string[] = [], optionCount = 4): Promise<Question> {
  if (!client) throw new Error(isOpenRouter
    ? "OPENROUTER_API_KEY is not configured"
    : "OPENAI_API_KEY is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt <= env.AI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await withAiRateLimit(() => client.responses.create({
        model: isOpenRouter ? env.OPENROUTER_MODEL : env.OPENAI_MODEL,
        input: dilemmaPrompt + " Create one accurate, inclusive multiple-choice quiz question about " + topic +
          " in " + language + ". " + (allowedOptions.length
            ? "Use exactly these answer options: " + allowedOptions.join(", ") + "."
            : "Create exactly " + optionCount + " suitable answer options.") +
          " The explanation must be one short, interesting fact only about the correct answer. " +
          "Return JSON with language, topic, question, options, topicEmoji, optionEmojis, correctOption and explanation."
      }));
      return questionSchema.parse(normalizeQuestion(parseJson(response.output_text)));
    } catch (error) {
      lastError = error;
      if (attempt >= env.AI_MAX_RETRIES || !isRetryableAiError(error)) throw error;
      await sleep(Math.min(8_000, 1_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
}

function isRetryableAiError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: number; code?: string; name?: string };
  return apiError.status === 408 || apiError.status === 409 || apiError.status === 429 ||
    (typeof apiError.status === "number" && apiError.status >= 500) ||
    apiError.code === "ECONNRESET" || apiError.code === "ETIMEDOUT" || apiError.name === "FetchError";
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
  const options = Array.isArray(question.options) ? question.options.map(String) : [];
  const rawCorrect = question.correctOption;
  const optionEmojis = Array.isArray(question.optionEmojis) && question.optionEmojis.length === options.length
    ? question.optionEmojis.map(String)
    : options.map(() => "");
  const topicEmoji = typeof question.topicEmoji === "string" && question.topicEmoji.trim()
    ? question.topicEmoji.trim()
    : "";
  if (typeof rawCorrect !== "string") return { ...question, topicEmoji, optionEmojis };

  const normalized = rawCorrect.trim();
  const letterIndex = /^[A-D]$/i.test(normalized) ? normalized.toUpperCase().charCodeAt(0) - 65 : -1;
  const numericIndex = /^\d+$/.test(normalized) ? Number(normalized) : -1;
  const textIndex = options.findIndex((option) => option.toLowerCase() === normalized.toLowerCase());
  const correctOption = letterIndex >= 0 ? letterIndex : numericIndex >= 0 ? numericIndex : textIndex;
  return { ...question, topicEmoji, optionEmojis, correctOption };
}
