import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_REGISTER_GLOBAL: z.preprocess((value) => value === true || value === "true", z.boolean()).default(false),
  QUIZ_TIMEZONE: z.string().refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch { return false; }
  }, "Invalid quiz timezone").default("Europe/Warsaw"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-6-luna"),
  OPENAI_REASONING_EFFORT: z.enum(["low", "medium"]).default("low"),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(4096).default(2048),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  AI_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  AI_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000)
});

export const env = envSchema.parse(process.env);
