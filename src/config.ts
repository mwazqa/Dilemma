import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_REGISTER_GLOBAL: z.preprocess((value) => value === true || value === "true", z.boolean()).default(false),
  AI_PROVIDER: z.enum(["openai", "openrouter"]).default("openrouter"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b:free"),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  AI_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  AI_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000)
});

export const env = envSchema.parse(process.env);
