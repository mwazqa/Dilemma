import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

let snapshot;
try {
  const executable = join(process.cwd(), ".tools", "gitleaks", process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  if (!existsSync(executable)) throw new Error("Run npm run security:setup first");
  const scan = (mode, directory) => {
    const args = [mode, directory, "--config", join(process.cwd(), ".gitleaks.toml"), "--redact=100", "--no-banner", "--log-level=error"];
    if (mode === "git") args.push("--log-opts=--all");
    const result = spawnSync(executable, args, { stdio: "pipe" });
    if (result.status !== 0) throw new Error("Secret scan rejected or failed");
  };
  scan("git", ".");
  const fileList = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", stdio: "pipe" });
  if (fileList.status !== 0) throw new Error("Could not list candidate files");
  snapshot = mkdtempSync(join(tmpdir(), "dilemma-secret-scan-"));
  for (const file of new Set(fileList.stdout.split("\0").filter(Boolean))) {
    if (!existsSync(file)) continue;
    const data = readFileSync(file);
    if (/(^|\/)(\.env(?:\.(?!example$)[^/]+)?|[^/]+\.(key|pem|ppk|db)|id_(rsa|ed25519|ecdsa))$/i.test(file)) throw new Error("Private file type found in publication candidates");
    if (!data.includes(0) && /ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech/i.test(data.toString())) throw new Error("Private infrastructure endpoint found in publication candidates");
    const destination = join(snapshot, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
  scan("dir", snapshot);
  console.log("PASS: secret scan of history and current publication candidates.");
} catch {
  console.error("Secret scan blocked the operation. Check scanner installation, private file types and secret findings locally; raw output withheld.");
  process.exitCode = 1;
} finally {
  // Delete only the exact temporary directory created by this invocation.
  if (snapshot && resolve(dirname(snapshot)) === resolve(tmpdir()) && basename(snapshot).startsWith("dilemma-secret-scan-")) {
    try { rmSync(snapshot, { recursive: true, force: true }); }
    catch { console.error("Temporary scan cleanup failed. Raw output withheld."); process.exitCode = 1; }
  }
}
