import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");

try {
  const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
  database.exec(readFileSync(`prisma/migrations/${migrations[0]}/migration.sql`, "utf8"));
  database.exec(`INSERT INTO "Topic" (id, guildId, name, options, intervalDays, updatedAt) VALUES ('legacy', 'test', 'Legacy', '', 7, CURRENT_TIMESTAMP);
    INSERT INTO "GuildSettings" (guildId, language, updatedAt) VALUES ('test', 'pl', CURRENT_TIMESTAMP);
    INSERT INTO "GeneratedPoll" (id, guildId, topicId, messageId, channelId, question, options, correctOption, explanation) VALUES ('g', 'test', 'legacy', 'gmsg', 'channel', 'Question', 'A||B', 0, 'Fact');
    INSERT INTO "RandomPoll" (id, guildId, language, messageId, channelId, question, options, correctOption, explanation) VALUES ('r', 'test', 'pl', 'rmsg', 'channel', 'Question', 'A||B', 0, 'Fact');`);
  for (const migration of migrations.slice(1)) database.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  for (const table of ["Topic", "GuildSettings", "GeneratedPoll", "RandomPoll", "QuizSettlement", "QuizAnswer", "UserScore"]) {
    if (!tables.includes(table)) throw new Error(`Missing table after migration: ${table}`);
  }
  const topic = database.prepare('SELECT * FROM "Topic" WHERE id = ?').get("legacy");
  assert.equal(topic.difficulty, "medium");
  assert.equal(topic.intervalDays, 7);
  assert.equal(topic.name, "Legacy");
  const settings = database.prepare('SELECT * FROM "GuildSettings" WHERE guildId = ?').get("test");
  assert.equal(settings.defaultDifficulty, "medium");
  assert.equal(settings.language, "pl");
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
