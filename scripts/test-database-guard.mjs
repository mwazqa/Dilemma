export function requireTestDatabase(environment) {
  const database = new URL(environment.DATABASE_URL ?? "");
  if (environment.TEST_DATABASE_CONFIRMED !== "true" ||
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !environment.EXPECTED_TEST_HOST || database.hostname !== environment.EXPECTED_TEST_HOST ||
      database.hostname.includes("-pooler") ||
      !environment.EXPECTED_TEST_DATABASE || decodeURIComponent(database.pathname.slice(1)) !== environment.EXPECTED_TEST_DATABASE) {
    throw new Error("Explicit test-only host, database name and confirmation required.");
  }
  return database;
}
