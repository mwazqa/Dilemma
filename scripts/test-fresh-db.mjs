import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");

try {
  const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
  database.exec(readFileSync(`prisma/migrations/${migrations[0]}/migration.sql`, "utf8"));
  database.exec(`INSERT INTO "Topic" (id, guildId, name, options, intervalDays, generationTime, updatedAt) VALUES ('legacy', 'test', 'Legacy', '', 7, '06:45', CURRENT_TIMESTAMP);
    INSERT INTO "GuildSettings" (guildId, language, updatedAt) VALUES ('test', 'pl', CURRENT_TIMESTAMP);
    INSERT INTO "GeneratedPoll" (id, guildId, topicId, messageId, channelId, question, options, correctOption, explanation) VALUES ('g', 'test', 'legacy', 'gmsg', 'channel', 'Question', 'A||B', 0, 'Fact');
    INSERT INTO "RandomPoll" (id, guildId, language, messageId, channelId, question, options, correctOption, explanation) VALUES ('r', 'test', 'pl', 'rmsg', 'channel', 'Question', 'A||B', 0, 'Fact');`);
  for (const migration of migrations.slice(1)) {
    if (migration === "20261015120000_profile_badges") {
      database.exec(`INSERT INTO "UserScore" (guildId, userId, points, answered, correct, currentStreak, bestStreak, updatedAt) VALUES ('test', 'legacy-player', 10, 12, 10, 3, 4, CURRENT_TIMESTAMP)`);
    }
    database.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
  }
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  for (const table of ["Topic", "GuildSettings", "GeneratedPoll", "RandomPoll", "QuizSettlement", "QuizAnswer", "UserScore", "DailyQuizRun", "QuizChannel"]) {
    if (!tables.includes(table)) throw new Error(`Missing table after migration: ${table}`);
  }
  const topic = database.prepare('SELECT * FROM "Topic" WHERE id = ?').get("legacy");
  assert.equal(database.prepare('SELECT "creatorUserId" FROM "RandomPoll" WHERE id = ?').get("r").creatorUserId, null);
  database.prepare('UPDATE "RandomPoll" SET "creatorUserId" = ? WHERE id = ?').run("creator", "r");
  assert.equal(database.prepare('SELECT "creatorUserId" FROM "RandomPoll" WHERE id = ?').get("r").creatorUserId, "creator");
  const creatorMigration = "20261026120000_random_quiz_creator/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${creatorMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${creatorMigration}`, "utf8"));
  const channelMigration = "20261025120000_quiz_channels/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${channelMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${channelMigration}`, "utf8"));
  assert.equal(database.prepare('SELECT count(*) AS count FROM "QuizChannel"').get().count, 0);
  database.exec(`INSERT INTO "QuizChannel" (guildId, channelId) VALUES ('test', 'first'), ('test', 'second'), ('other', 'first')`);
  assert.throws(() => database.exec(`INSERT INTO "QuizChannel" (guildId, channelId) VALUES ('test', 'first')`));
  database.exec(`DELETE FROM "QuizChannel" WHERE guildId = 'test' AND channelId = 'first'`);
  assert.equal(database.prepare('SELECT count(*) AS count FROM "QuizChannel" WHERE guildId = ?').get('test').count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM "QuizChannel" WHERE guildId = ?').get('other').count, 1);
  assert.equal(topic.difficulty, "medium");
  assert.equal(topic.intervalDays, 7);
  assert.equal(topic.name, "Legacy");
  assert.equal(topic.generationTime, "06:45", "Do not replace existing topic schedules");
  assert.equal(topic.startDate, null, "Do not change legacy schedules when adding fixed start dates");
  assert.equal(topic.pingRoleId, null, "Existing schedules do not start pinging after an upgrade");
  const pingMigration = "20261025150000_quiz_ping_role/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${pingMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${pingMigration}`, "utf8"));
  database.exec(`UPDATE "Topic" SET "pingRoleId" = 'fixture-notification-role' WHERE id = 'legacy'`);
  assert.equal(database.prepare('SELECT pingRoleId FROM "Topic" WHERE id = ?').get("legacy").pingRoleId, "fixture-notification-role");
  const startDateMigration = "20261021120000_topic_start_date/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${startDateMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${startDateMigration}`, "utf8"));
  database.exec(`UPDATE "Topic" SET "startDate" = '2026-10-26' WHERE id = 'legacy'`);
  assert.equal(database.prepare('SELECT startDate FROM "Topic" WHERE id = ?').get("legacy").startDate, "2026-10-26");
  assert.equal(topic.pollDurationHours, 24);
  assert.equal(topic.questionsPerRun, 3, "Legacy column remains usable by the rollback version");
  const settings = database.prepare('SELECT * FROM "GuildSettings" WHERE guildId = ?').get("test");
  assert.equal(settings.defaultDifficulty, "medium");
  assert.equal(settings.language, "pl");
  assert.equal(settings.managerRoleId, null, "Existing servers keep administrator-only management");
  assert.equal(settings.timezone, null, "Existing servers keep the deployment timezone until explicitly configured");
  const timezoneMigration = "20261022190000_guild_timezone/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${timezoneMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${timezoneMigration}`, "utf8"));
  database.exec(`UPDATE "GuildSettings" SET "timezone" = 'Europe/London' WHERE "guildId" = 'test'`);
  assert.equal(database.prepare('SELECT timezone FROM "GuildSettings" WHERE guildId = ?').get("test").timezone, "Europe/London");
  const managementMigration = "20261022160000_manager_role/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${managementMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${managementMigration}`, "utf8"));
  database.exec(`UPDATE "GuildSettings" SET "managerRoleId" = 'fixture-role' WHERE "guildId" = 'test'`);
  assert.equal(database.prepare('SELECT managerRoleId FROM "GuildSettings" WHERE guildId = ?').get("test").managerRoleId, "fixture-role");
  assert.equal(settings.defaultPollDurationHours, 24);
  assert.equal(settings.defaultGenerationTime, null, "Do not automatically enable schedules for existing servers");
  const scheduleMigration = "20261012120000_default_generation_time/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${scheduleMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${scheduleMigration}`, "utf8"), "Keep the additive schedule migration aligned across providers");
  database.exec(`UPDATE "GuildSettings" SET "defaultGenerationTime" = '18:30' WHERE "guildId" = 'test'`);
  assert.equal(database.prepare('SELECT defaultGenerationTime FROM "GuildSettings" WHERE guildId = ?').get("test").defaultGenerationTime, "18:30");
  assert.equal(database.prepare('SELECT generationTime FROM "Topic" WHERE id = ?').get("legacy").generationTime, "06:45");
  assert.equal(settings.defaultQuestionsPerRun, 3, "Preserve rollback compatibility");
  const badgeMigration = "20261015120000_profile_badges/migration.sql";
  assert.equal(readFileSync(`prisma/migrations/${badgeMigration}`, "utf8"), readFileSync(`prisma/postgresql/migrations/${badgeMigration}`, "utf8"));
  const legacyPlayer = database.prepare('SELECT * FROM "UserScore" WHERE userId = ?').get("legacy-player");
  assert.equal(legacyPlayer.selectedBadge, null);
  assert.deepEqual([legacyPlayer.points, legacyPlayer.answered, legacyPlayer.correct, legacyPlayer.currentStreak, legacyPlayer.bestStreak], [10, 12, 10, 3, 4]);
  database.exec(`UPDATE "UserScore" SET selectedBadge = 'first_answer' WHERE guildId = 'test' AND userId = 'legacy-player'`);
  assert.equal(database.prepare('SELECT selectedBadge FROM "UserScore" WHERE userId = ?').get("legacy-player").selectedBadge, "first_answer");
  const badges = ["first_answer", "correct_10", "level_2"];
  database.prepare('UPDATE "UserScore" SET selectedBadge = ? WHERE guildId = ? AND userId = ?')
    .run(JSON.stringify(badges), "test", "legacy-player");
  assert.deepEqual(JSON.parse(database.prepare('SELECT selectedBadge FROM "UserScore" WHERE userId = ?').get("legacy-player").selectedBadge), badges);
  database.exec(`INSERT INTO "DailyQuizRun" (guildId, scope, day, slot) VALUES ('test', 'random', '2026-10-08', 1)`);
  assert.throws(() => database.exec(`INSERT INTO "DailyQuizRun" (guildId, scope, day, slot) VALUES ('test', 'random', '2026-10-08', 1)`));
  database.exec(`INSERT INTO "DailyQuizRun" (guildId, scope, day, slot) VALUES ('test', 'random', '2026-10-09', 1)`);
  for (const table of ["GeneratedPoll", "RandomPoll"]) assert.equal(database.prepare(`SELECT difficulty FROM "${table}"`).get().difficulty, "medium");
  database.exec('UPDATE "Topic" SET difficulty = \'hard\' WHERE id = \'legacy\'');
  assert.equal(database.prepare('SELECT difficulty FROM "Topic"').get().difficulty, "hard");
  assert.equal(database.prepare('SELECT count(*) AS count FROM "QuizSettlement"').get().count, 0);
  database.exec(`INSERT INTO "QuizSettlement" (messageId, guildId, channelId, difficulty, correctAnswerId, answerIds, expiresAt) VALUES ('score-test', 'test', 'channel', 'hard', 17, '17,93', CURRENT_TIMESTAMP);
    INSERT INTO "QuizAnswer" (messageId, userId, guildId, answerId, correct, points, finishedAt) VALUES ('score-test', 'player', 'test', 17, true, 3, CURRENT_TIMESTAMP);`);
  assert.throws(() => database.exec(`INSERT INTO "QuizAnswer" (messageId, userId, guildId, answerId, correct, points, finishedAt) VALUES ('score-test', 'player', 'test', 17, true, 3, CURRENT_TIMESTAMP)`));
  database.exec('DELETE FROM "QuizSettlement" WHERE messageId = \'score-test\'');
  assert.equal(database.prepare('SELECT count(*) AS count FROM "QuizAnswer"').get().count, 0);
  console.log("PASS: SQLite migrations preserve existing data, scoring uniqueness and cascade deletion");
} finally {
  database.close();
}
