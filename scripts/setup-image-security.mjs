import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export const modelRevision = "806cd9adc8c6e8abc11c782db1818c990576bebc";
const expectedHashes = { eng: "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468", pol: "a5c03eb3affa5cd8c5fbe89fc394240a8f1165f10ffb839c57f8117131f2f359" };
try {
  const directory = resolve(".tools/ocr");
  mkdirSync(directory, { recursive: true });
  const hashes = {};
  for (const language of ["eng", "pol"]) {
    const response = await fetch(`https://raw.githubusercontent.com/naptha/tessdata/${modelRevision}/4.0.0/${language}.traineddata.gz`);
    if (!response.ok) throw new Error("Model download failed");
    const data = Buffer.from(await response.arrayBuffer());
    hashes[language] = createHash("sha256").update(data).digest("hex");
    if (hashes[language] !== expectedHashes[language]) throw new Error("OCR model checksum mismatch");
    writeFileSync(resolve(directory, `${language}.traineddata.gz`), data);
  }
  writeFileSync(resolve(directory, "models.json"), JSON.stringify({ revision: modelRevision, hashes }));
  console.log("PASS: local OCR models installed from a pinned official revision.");
} catch {
  console.error("Image security setup failed. Raw output withheld.");
  process.exitCode = 1;
}
