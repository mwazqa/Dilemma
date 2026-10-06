import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

const [source, destination] = process.argv.slice(2);
if (!source || !destination || source === destination) {
  throw new Error("Provide distinct source and destination environment files.");
}
const values = parse(readFileSync(source));
if (!/^postgres(?:ql)?:\/\//.test(values.DATABASE_URL ?? "")) {
  throw new Error("DATABASE_URL must use PostgreSQL.");
}
const lines = Object.entries(values).map(([key, value]) => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Docker environment value must be single-line: ${key}`);
  }
  return `${key}=${value}`;
});
writeFileSync(destination, lines.join("\n") + "\n", { mode: 0o600 });
console.log("Docker environment file prepared.");
