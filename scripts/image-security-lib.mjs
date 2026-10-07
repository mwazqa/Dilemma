import sharp from "sharp";
import jsQR from "jsqr";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createWorker, PSM } from "tesseract.js";
import { spawnSync } from "node:child_process";

export const digest = data => createHash("sha256").update(data).digest("hex");
export function sensitiveText(text) {
  return /(?:sk-[\w-]{16,}|postgres(?:ql)?:\/\/|discord(?:app)?\.com\/api\/(?:v\d+\/)?(?:webhooks|interactions)\/|-----BEGIN .*PRIVATE KEY|(?:token|password|secret|api[_ -]?key|authorization)\s*[:=]\s*\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|[A-Z]:[\\/](?:Users|home)[\\/]|ep-[\w.-]+\.neon\.tech)/i.test(text);
}

export async function makeWorker() {
  const directory = resolve(".tools/ocr");
  const manifest = JSON.parse(readFileSync(resolve(directory, "models.json"), "utf8"));
  const expectedHashes = { eng: "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468", pol: "a5c03eb3affa5cd8c5fbe89fc394240a8f1165f10ffb839c57f8117131f2f359" };
  if (manifest.revision !== "806cd9adc8c6e8abc11c782db1818c990576bebc") throw new Error("Model revision mismatch");
  for (const language of ["eng", "pol"]) {
    if (digest(readFileSync(resolve(directory, `${language}.traineddata.gz`))) !== expectedHashes[language]) throw new Error("Model checksum mismatch");
  }
  const worker = await createWorker("eng+pol", 1, { langPath: directory, cacheMethod: "none", gzip: true, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "150" });
  return worker;
}

export function hasPngText(data) {
  if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (offset + length + 12 > data.length) throw new Error("Malformed PNG");
    if (["tEXt", "zTXt", "iTXt", "eXIf"].includes(data.toString("ascii", offset + 4, offset + 8))) return true;
    offset += length + 12;
  }
  return false;
}

export async function inspectImage(data, worker) {
  const metadata = await sharp(data, { limitInputPixels: 40_000_000 }).metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported image; manual conversion required");
  const hiddenMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc || metadata.icc || (metadata.comments?.length) || hasPngText(data));
  const opaque = sharp(data).flatten({ background: "#ffffff" });
  const { data: pixels, info } = await opaque.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Reject any detected QR. Never print, open or follow its payload.
  const qr = Boolean(jsQR(new Uint8ClampedArray(pixels), info.width, info.height, { inversionAttempts: "attemptBoth" }));
  // Analyze both backgrounds so alpha cannot trivially hide visible text.
  const light = await opaque.clone().png().toBuffer();
  const dark = await sharp(data).flatten({ background: "#000000" }).png().toBuffer();
  const lightText = (await worker.recognize(light)).data.text;
  const darkText = (await worker.recognize(dark)).data.text;
  const scanner = resolve(".tools/gitleaks", process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  const recognized = `${lightText}\n${darkText}`;
  const secretScan = spawnSync(scanner, ["stdin", "--config", resolve(".gitleaks.toml"), "--redact=100", "--no-banner", "--log-level=error"], { input: recognized, encoding: "utf8", stdio: "pipe" });
  if (![0, 1].includes(secretScan.status)) throw new Error("OCR secret scanner unavailable");
  const { data: darkPixels, info: darkInfo } = await sharp(dark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const darkQr = Boolean(jsQR(new Uint8ClampedArray(darkPixels), darkInfo.width, darkInfo.height, { inversionAttempts: "attemptBoth" }));
  return { hiddenMetadata, qr: qr || darkQr, sensitive: sensitiveText(recognized) || secretScan.status === 1, hash: digest(data) };
}
