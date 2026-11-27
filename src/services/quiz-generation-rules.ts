import { createHash } from "node:crypto";
import { safeReportText } from "./quiz-report-review.js";

export const GENERATION_RULE_MAX_LENGTH = 240;

export function cleanGenerationRule(value: string) {
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (text.length > GENERATION_RULE_MAX_LENGTH || safeReportText(text) !== text ||
    /\b\d{17,20}\b|<(?:[@#]|a?:)|(?:https?:\/\/|www\.|discord(?:app)?\.com\/|discord\.gg\/)/i.test(text)) return "";
  return text;
}

export function generationRuleKey(text: string) {
  return createHash("sha256").update(text.toLowerCase().replace(/[.!?]+$/u, "").trimEnd()).digest("hex");
}
