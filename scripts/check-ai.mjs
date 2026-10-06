import { generateQuestion } from "../dist/services/question-generator.js";

const started = Date.now();
try {
  const question = await generateQuestion("geography", "pl", [], 4);
  console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - started, language: question.language, optionCount: question.options.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, elapsedMs: Date.now() - started, type: error?.name, status: error?.status }));
  process.exitCode = 1;
}
