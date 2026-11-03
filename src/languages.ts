export const languageCodes = ["en", "pl"] as const;
export type Language = typeof languageCodes[number];

export const languageNames: Record<Language, string> = {
  en: "English", pl: "Polish"
};

export const supportedLanguages = [
  { name: "English", value: "en" },
  { name: "Polski", value: "pl" }
] as const;

export function isSupportedLanguage(value: string): value is Language {
  return languageCodes.includes(value as Language);
}

export function normalizeLanguage(value: string): Language {
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLanguage(base) ? base : "en";
}
