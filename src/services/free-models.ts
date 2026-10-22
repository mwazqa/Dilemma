import { z } from "zod";
import { env } from "../config.js";

const zeroPrice = z.union([z.literal(0), z.string().regex(/^0(?:\.0+)?(?:e[+-]?\d+)?$/i)]);
const modelSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?::free)?$/).refine(id => !id.startsWith("openrouter/")),
  pricing: z.object({ prompt: zeroPrice, completion: zeroPrice, request: zeroPrice.optional() }),
  architecture: z.object({ input_modalities: z.array(z.string()).refine(values => values.includes("text")),
    output_modalities: z.array(z.string()).refine(values => values.includes("text")) }),
  supported_parameters: z.array(z.string()).refine(values => ["response_format", "reasoning", "max_tokens"].every(value => values.includes(value))),
  reasoning: z.object({ mandatory: z.boolean().optional() }).nullish().refine(value => !value?.mandatory),
  context_length: z.number().int().min(16_384),
  expiration_date: z.string().nullable().optional()
});
type FreeModel = { id: string; expiresAt: number };
let cached: FreeModel[] = [];
let expiresAt = 0;
let cursor = 0;
let pending: Promise<FreeModel[]> | undefined;

async function loadModels(): Promise<FreeModel[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models/user", {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      redirect: "error", signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) throw new Error("Model catalog unavailable");
    const content = await response.text();
    if (content.length > 8 * 1024 * 1024) throw new Error("Model catalog too large");
    const catalog: unknown = JSON.parse(content);
    if (!catalog || typeof catalog !== "object" || !("data" in catalog) || !Array.isArray(catalog.data)) throw new Error("Invalid model catalog");
    const models = new Map<string, FreeModel>();
    for (const entry of catalog.data) {
      const parsed = modelSchema.safeParse(entry);
      if (!parsed.success) continue;
      const model = parsed.data;
      const expiration = model.expiration_date == null ? Infinity : Date.parse(model.expiration_date);
      if (!(expiration > Date.now())) continue;
      models.set(model.id, { id: model.id, expiresAt: expiration });
    }
    cached = [...models.values()].sort((first, second) => first.id.localeCompare(second.id));
    expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  } catch {
    cached = [];
    expiresAt = Date.now() + 30_000;
  }
  return cached;
}

export async function discoverFreeModels(excluded: readonly string[], signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  if (!env.OPENROUTER_API_KEY) return [];
  if (Date.now() >= expiresAt) {
    pending ??= loadModels().finally(() => { pending = undefined; });
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      pending!.then(() => resolve(), reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  signal.throwIfAborted();
  const candidates = cached.filter(model => model.expiresAt > Date.now() && !excluded.includes(model.id));
  if (!candidates.length) return [];
  const start = cursor % candidates.length;
  const selected = Array.from({ length: Math.min(3, candidates.length) }, (_, index) => candidates[(start + index) % candidates.length].id);
  cursor = (start + selected.length) % candidates.length;
  return selected;
}
