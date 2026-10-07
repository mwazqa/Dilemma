import { spawnSync } from "node:child_process";
for (const file of ["scripts/check-secrets.mjs", "scripts/check-images.mjs"]) {
  const result = spawnSync(process.execPath, [file], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    console.error("Publication blocked: secret/image checks failed or require visual review. Run local security commands for sanitized counts.");
    process.exit(1);
  }
}
console.log("PASS: publication secret and image checks.");
