export const randomCategoryWindow = 64;

export function recentRandomCategories(history: (string | null)[]): string[] {
  return history.filter((category): category is string => typeof category === "string" && category.trim().length > 0)
    .slice(0, randomCategoryWindow);
}

export function normalizeRandomCategory(category: string): string {
  return category.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
