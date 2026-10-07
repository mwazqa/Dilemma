import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { makeWorker, inspectImage } from "./image-security-lib.mjs";
import { digest } from "./image-security-lib.mjs";

let worker;
try {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Cannot list candidates");
  const candidates = [...new Set(result.stdout.split("\0").filter(file => /\.(png|jpe?g|webp|gif|svg|bmp|tiff?|ico|avif|heic)$/i.test(file) && existsSync(file)))];
  const reviews = existsSync("image-publication-reviews.json") ? JSON.parse(readFileSync("image-publication-reviews.json", "utf8")) : { reviewedSha256: [] };
  const inputs = candidates.map(file => readFileSync(file));
  const currentHashes = new Set(inputs.map(digest));
  const history = spawnSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8", stdio: "pipe" });
  if (history.status !== 0) throw new Error("Cannot inspect image history");
  let historicalBlobs = 0;
  for (const line of history.stdout.split("\n")) {
    const match = line.match(/^([a-f0-9]{40}) .+\.(?:png|jpe?g|webp|gif|svg|bmp|tiff?|ico|avif|heic)$/i);
    if (!match) continue;
    const blob = spawnSync("git", ["cat-file", "blob", match[1]], { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
    if (blob.status !== 0) throw new Error("Cannot read historical image");
    historicalBlobs++;
    const hash = digest(blob.stdout);
    if (!currentHashes.has(hash)) { inputs.push(blob.stdout); currentHashes.add(hash); }
  }
  const counts = { checked: 0, historicalBlobs, metadata: 0, qr: 0, sensitive: 0, unsupported: 0, visualReviewRequired: 0 };
  if (inputs.length) worker = await makeWorker();
  for (const input of inputs) {
    try {
      const finding = await inspectImage(input, worker);
      counts.checked++;
      for (const category of ["metadata", "qr", "sensitive"]) if (finding[category === "metadata" ? "hiddenMetadata" : category]) counts[category]++;
      if (!reviews.reviewedSha256.includes(finding.hash)) counts.visualReviewRequired++;
    } catch {
      counts.unsupported++;
    }
  }
  console.log(JSON.stringify(counts));
  if (Object.entries(counts).some(([key, value]) => !["checked", "historicalBlobs"].includes(key) && value > 0)) process.exitCode = 1;
} catch {
  console.error("Image publication check blocked. Raw image data and recognized text withheld.");
  process.exitCode = 1;
} finally {
  await worker?.terminate();
}
