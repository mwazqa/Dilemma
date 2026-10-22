import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_REGISTER_GLOBAL: z.preprocess((value) => value === true || value === "true", z.boolean()).default(false),
  AI_PROVIDER: z.enum(["openai", "openrouter"]).default("openrouter"),
  QUIZ_TIMEZONE: z.string().refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch { return false; }
  }, "Invalid quiz timezone").default("Europe/Warsaw"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("dots-studio/dots-3-note-preview:free"),
  OPENROUTER_FALLBACK_MODELS: z.string().default("dots-studio/dots-3-note-preview:free,xingchen-agi/xing4.0-29b-a4b:free,google/gemma-4-31b-it:free").transform(value => [...new Set(value.split(",").map(model => model.trim()).filter(Boolean))]).refine(models => models.length <= 3 && models.every(model => /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+:free$/.test(model)), "Use up to three free fallback model IDs"),
  OPENROUTER_DYNAMIC_FALLBACK: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  AI_MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  AI_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  AI_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000)
});

export const env = envSchema.parse(process.env);
