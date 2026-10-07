const errorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "ZodError", "APIError", "DiscordAPIError", "PrismaClientKnownRequestError", "PrismaClientInitializationError"]);

// Never return messages, stacks, URLs, request objects or arbitrary custom names.
export function privateErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown failure";
  const name = error.name.replace(/\[\d+\]$/, "");
  return errorNames.has(name) ? name : "Error";
}

// Prevent Node's default fatal-error printer from dumping secret-bearing objects.
process.on("uncaughtException", (error) => {
  console.error("Fatal error:", privateErrorSummary(error));
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", privateErrorSummary(error));
  process.exit(1);
});
