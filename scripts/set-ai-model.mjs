import { readFileSync, writeFileSync } from "node:fs";

const [file, model] = process.argv.slice(2);
if (!file || !model || !/^[a-z0-9_.\/-]+:free$/.test(model)) {
  throw new Error("Provide an environment file and a fixed free OpenRouter model ID.");
}
const content = readFileSync(file, "utf8");
const line = `OPENROUTER_MODEL=${model}`;
const updated = /^OPENROUTER_MODEL=.*$/m.test(content)
  ? content.replace(/^OPENROUTER_MODEL=.*$/m, line)
  : content.trimEnd() + "\n" + line + "\n";
writeFileSync(file, updated, { mode: 0o600 });
console.log("Fixed free AI model saved. Other environment values preserved.");
