export function storedQuizOptions(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed.length <= 4 && parsed.every(option => typeof option === "string")) return parsed;
  } catch { }
  return value.split("||");
}
