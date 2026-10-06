import { z } from "zod";
import type { SlashCommandStringOption } from "discord.js";

export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;
export const defaultDifficulty: Difficulty = "medium";
export function parseDifficulty(value: unknown): Difficulty {
  return difficultySchema.parse(value ?? defaultDifficulty);
}
export function difficultyOption(option: SlashCommandStringOption) {
  return option.setName("difficulty").setDescription("Question difficulty; omitted uses the saved default.")
    .addChoices(
      { name: "Easy", value: "easy", name_localizations: { pl: "Łatwy", de: "Leicht", "es-ES": "Fácil", fr: "Facile", ja: "やさしい" } },
      { name: "Medium", value: "medium", name_localizations: { pl: "Średni", de: "Mittel", "es-ES": "Medio", fr: "Moyen", ja: "ふつう" } },
      { name: "Hard", value: "hard", name_localizations: { pl: "Trudny", de: "Schwer", "es-ES": "Difícil", fr: "Difficile", ja: "むずかしい" } }
    );
}
export const difficultyInstructions: Record<Difficulty, string> = {
  easy: "Use common everyday knowledge and clearly distinct, plausible answers. Suitable for beginners.",
  medium: "Use general knowledge beyond the most obvious facts, with plausible distractors. Suitable for a typical adult quiz player.",
  hard: "Use advanced but verifiable knowledge with close, plausible distractors. Require topic expertise, not ambiguous wording or trick questions."
};
