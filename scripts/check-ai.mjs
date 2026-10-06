import { generateQuestion } from "../dist/services/question-generator.js";

const started = Date.now();
try {
  const difficulty = process.argv[2] ?? "medium";
  if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error("Invalid difficulty");
  const question = await generateQuestion("geography", "pl", [], 4, [], undefined, difficulty);
  console.log(JSON.stringify({ ok: true, difficulty, elapsedMs: Date.now() - started, language: question.language, optionCount: question.options.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, elapsedMs: Date.now() - started, type: error?.name, status: error?.status }));
  process.exitCode = 1;
}
