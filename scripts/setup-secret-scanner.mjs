import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

try {
  const version = "8.30.1";
  const platform = { win32: "windows", linux: "linux", darwin: "darwin" }[process.platform];
  const arch = { x64: "x64", arm64: "arm64" }[process.arch];
  if (!platform || !arch) throw new Error("Unsupported scanner platform");
  const extension = process.platform === "win32" ? "zip" : "tar.gz";
  const asset = `gitleaks_${version}_${platform}_${arch}.${extension}`;
  const base = `https://github.com/gitleaks/gitleaks/releases/download/v${version}`;
  const download = async name => {
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error("Scanner download failed");
    return Buffer.from(await response.arrayBuffer());
  };
  const archive = await download(asset);
  const checksums = (await download(`gitleaks_${version}_checksums.txt`)).toString();
  const expected = checksums.split(/\r?\n/).find(line => line.trim().endsWith(asset))?.trim().split(/\s+/)[0];
  if (!expected || createHash("sha256").update(archive).digest("hex") !== expected) throw new Error("Scanner checksum mismatch");
  const directory = mkdtempSync(join(tmpdir(), "dilemma-scanner-"));
  const archivePath = join(directory, asset);
  writeFileSync(archivePath, archive);
  const extracted = join(directory, "extracted");
  mkdirSync(extracted);
  const result = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:DILEMMA_SCANNER_ARCHIVE -DestinationPath $env:DILEMMA_SCANNER_OUTPUT"], { env: { ...process.env, DILEMMA_SCANNER_ARCHIVE: archivePath, DILEMMA_SCANNER_OUTPUT: extracted }, stdio: "pipe" })
    : spawnSync("tar", ["-xzf", archivePath, "-C", extracted], { stdio: "pipe" });
  if (result.status !== 0) throw new Error("Scanner extraction failed");
  const executable = process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
  const destination = join(".tools", "gitleaks");
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(extracted, executable), join(destination, executable));
  if (process.platform !== "win32") {
    chmodSync(join(destination, executable), 0o755);
    chmodSync(join(".githooks", "pre-push"), 0o755);
  }
  console.log("Gitleaks installed; release checksum verified.");
} catch {
  console.error("Scanner setup failed. Raw diagnostics withheld for privacy.");
  process.exitCode = 1;
}
