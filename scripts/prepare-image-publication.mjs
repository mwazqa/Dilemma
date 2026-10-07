import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import sharp from "sharp";
import { makeWorker, inspectImage } from "./image-security-lib.mjs";

let worker;
try {
  if (process.argv.length !== 3) throw new Error("Supply one local image");
  const source = readFileSync(process.argv[2]);
  worker = await makeWorker();
  // New flattened PNG drops metadata and alpha-hidden pixel data. Original stays untouched.
  const data = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const findings = await inspectImage(data, worker);
  if (findings.hiddenMetadata || findings.qr || findings.sensitive) throw new Error("Unsafe image");
  const directory = resolve(".tools/image-publication");
  mkdirSync(directory, { recursive: true });
  const name = basename(process.argv[2]).replace(/[^a-zA-Z0-9_.-]/g, "_") + ".clean.png";
  writeFileSync(resolve(directory, name), data, { flag: "wx" });
  console.log("PASS: metadata-free publication copy prepared locally. Visual review still required; original preserved.");
} catch {
  console.error("Image preparation blocked. Raw data withheld.");
  process.exitCode = 1;
} finally {
  await worker?.terminate();
}
