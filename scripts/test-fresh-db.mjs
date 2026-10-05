import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = "prisma/fresh-db-test.db";
const migrationPath = "prisma/migrations/20261005202000_init/migration.sql";

try {
  const database = new DatabaseSync(databasePath);
  database.exec(readFileSync(migrationPath, "utf8"));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  for (const table of ["Topic", "GuildSettings", "GeneratedPoll"]) {
    if (!tables.includes(table)) throw new Error(`Missing table after migration: ${table}`);
  }
  database.close();
  console.log("Fresh database migration passed.");
} finally {
  if (existsSync(databasePath)) unlinkSync(databasePath);
}
