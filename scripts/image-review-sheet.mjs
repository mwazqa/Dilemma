import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

try {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Cannot list candidates");
  const files = [...new Set(result.stdout.split("\0").filter(file => /\.(png|jpe?g|webp)$/i.test(file)))].sort();
  const width = 360, height = 240, columns = 5;
  const composites = [];
  for (let index = 0; index < files.length; index++) {
    const data = await sharp(readFileSync(files[index])).resize(width - 8, height - 28, { fit: "inside" }).flatten({ background: "#eeeeee" }).png().toBuffer();
    const info = await sharp(data).metadata();
    const left = (index % columns) * width;
    const top = Math.floor(index / columns) * height;
    composites.push({ input: data, left: left + Math.floor((width - info.width) / 2), top: top + 24 });
    composites.push({ input: Buffer.from(`<svg width="${width}" height="24"><text x="8" y="18" font-size="16" fill="black">${index + 1}</text></svg>`), left, top });
  }
  mkdirSync(".tools", { recursive: true });
  await sharp({ create: { width: columns * width, height: Math.ceil(files.length / columns) * height, channels: 3, background: "#eeeeee" } }).composite(composites).png().toFile(".tools/image-review.png");
  console.log(`PASS: local visual review sheet prepared; images=${files.length}.`);
} catch {
  console.error("Review sheet creation failed. Raw output withheld.");
  process.exitCode = 1;
}
