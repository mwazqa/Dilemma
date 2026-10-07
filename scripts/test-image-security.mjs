import assert from "node:assert/strict";
import sharp from "sharp";
import QRCode from "qrcode";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { digest } from "./image-security-lib.mjs";
import { makeWorker, inspectImage, sensitiveText, hasPngText } from "./image-security-lib.mjs";

let worker;
try {
  assert.equal(sensitiveText("password=synthetic-value-only"), true);
  assert.equal(sensitiveText("hello artwork"), false);
  worker = await makeWorker();
  const image = sharp({ create: { width: 600, height: 100, channels: 3, background: "white" } });
  const clean = await image.clone().png().toBuffer();
  assert.equal(hasPngText(clean), false);
  const baseline = await inspectImage(clean, worker);
  assert.equal(baseline.hiddenMetadata || baseline.qr || baseline.sensitive, false);
  const exif = await image.clone().withExif({ IFD0: { Artist: "synthetic-test-author" } }).png().toBuffer();
  assert.equal((await inspectImage(exif, worker)).hiddenMetadata, true);
  mkdirSync(".tools/image-tests", { recursive: true });
  const fixture = `.tools/image-tests/metadata-${Date.now()}.png`;
  writeFileSync(fixture, exif);
  const preparation = spawnSync(process.execPath, ["scripts/prepare-image-publication.mjs", fixture], { stdio: "pipe" });
  assert.equal(preparation.status, 0);
  assert.equal(digest(readFileSync(fixture)), digest(exif));
  const cleanCopy = `.tools/image-publication/${fixture.split('/').at(-1)}.clean.png`;
  assert.equal(existsSync(cleanCopy), true);
  assert.equal((await inspectImage(readFileSync(cleanCopy), worker)).hiddenMetadata, false);
  const qr = await QRCode.toBuffer("synthetic-test-payload", { width: 512, margin: 4 });
  assert.equal((await inspectImage(qr, worker)).qr, true);
  const textImage = Buffer.from('<svg width="1000" height="160"><rect width="100%" height="100%" fill="white"/><text x="20" y="100" font-size="60" font-family="sans-serif" fill="black">password=synthetic-value</text></svg>');
  const text = await sharp(textImage).png().toBuffer();
  assert.equal((await inspectImage(text, worker)).sensitive, true);
  console.log("PASS: image metadata, QR, OCR and clean-image regression tests.");
} catch {
  console.error("Image privacy regression failed. Raw output withheld.");
  process.exitCode = 1;
} finally {
  await worker?.terminate();
}
