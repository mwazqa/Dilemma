import sharp from "sharp";
import { isAchievementId, maxDisplayedBadges, type AchievementId } from "./achievements.js";
import { achievementIcon } from "./achievement-icons.js";

export interface ScoreCardData {
  title: string;
  level: string;
  rank: number | null;
  points: string;
  experience: string;
  percent: number;
  answersLabel: string;
  answers: string;
  correctLabel: string;
  correct: string;
  streakLabel: string;
  streak: string;
  badges?: readonly { id: AchievementId; name: string }[];
}

export function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const cardFont = process.platform === "win32" ? "Arial" : "DejaVu Sans";
export function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), item => item.segment);
}

export function boundedText(value: string, maxUnits: number): string {
  let result = "";
  for (const segment of graphemes(value)) {
    if (result.length + segment.length > maxUnits) break;
    result += segment;
  }
  return result;
}

async function textWidth(value: string, size: number, bold: boolean): Promise<number> {
  if (!value) return 0;
  const result = await sharp({ text: { text: escapeXml(value), font: `${cardFont} ${bold ? "Bold " : ""}${size}`, rgba: true } })
    .png().toBuffer({ resolveWithObject: true });
  return result.info.width;
}

export async function fitText(value: string, width: number, initial = 40, minimum = 26, bold = true) {
  const clean = value.replace(/[\r\n\t]+/g, " ");
  const segments = graphemes(clean);
  // Bound work even if a malformed name contains thousands of characters.
  const candidate = segments.length > 256 ? `${segments.slice(0, 256).join("")}…` : clean;
  for (let size = initial; size >= minimum; size -= 2) {
    if (await textWidth(candidate, size, bold) <= width) return { text: candidate, size };
  }
  let low = 0, high = Math.min(segments.length, 256);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (await textWidth(`${segments.slice(0, middle).join("")}…`, minimum, bold) <= width) low = middle;
    else high = middle - 1;
  }
  return { text: `${segments.slice(0, low).join("")}…`, size: minimum };
}

export function allowedAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/(?:avatars\/\d+\/[a-zA-Z0-9_]+\.(?:png|webp|jpg)|guilds\/\d+\/users\/\d+\/avatars\/[a-zA-Z0-9_]+\.(?:png|webp|jpg)|embed\/avatars\/\d+\.png)$/.test(url.pathname);
  } catch { return false; }
}

export async function loadAvatar(url?: string): Promise<Buffer | undefined> {
  if (!url || !allowedAvatarUrl(url)) return undefined;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok || !/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body) return undefined;
    const maxBytes = 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); return undefined; }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > maxBytes) { await reader.cancel(); return undefined; }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const input = Buffer.concat(chunks);
    const image = sharp(input, { limitInputPixels: 1024 * 1024 });
    const metadata = await image.metadata();
    // Reject SVG and other active/unexpected input; re-encode to strip metadata.
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) return undefined;
    return await image.resize(144, 144, { fit: "cover" }).png().toBuffer();
  } catch {
    // No URLs, response bodies or user data in logs. A local placeholder is enough.
    return undefined;
  }
}

export async function scoreCardSvg(data: ScoreCardData, avatar?: Buffer): Promise<string> {
  const title = await fitText(data.title, 675);
  const level = await fitText(data.level, 340, 32, 24);
  const badges = (data.badges ?? []).filter((badge, index, all) => isAchievementId(badge.id)
    && all.findIndex(item => item.id === badge.id) === index).slice(0, maxDisplayedBadges);
  const points = await fitText(data.points, badges.length ? 600 : 650, 26, 20, false);
  const ranked = Number.isSafeInteger(data.rank) && data.rank !== null && data.rank > 0;
  const podium = ranked && data.rank! <= 3;
  const rankStyle = podium ? [
    { tier: "gold", color: "#f2c879", background: "#524022" },
    { tier: "silver", color: "#d8e2f4", background: "#3d465d" },
    { tier: "bronze", color: "#dba477", background: "#4c342e" }
  ][data.rank! - 1] : { tier: ranked ? "standard" : "unranked", color: "#aaa0ce", background: "#20223e" };
  const rank = await fitText(ranked ? `#${data.rank}` : "-", 102, podium ? 34 : 26, 18, podium);
  const experience = await fitText(data.experience, 790, 25, 18, false);
  const labels = await Promise.all([data.answersLabel, data.correctLabel, data.streakLabel].map(label => fitText(label, 225, 21, 15, false)));
  const values = await Promise.all([data.answers, data.correct, data.streak].map(value => fitText(value, 225, 32, 20)));
  const percent = Math.max(0, Math.min(100, Number.isFinite(data.percent) ? data.percent : 0));
  const filled = 1008 * percent / 100;
  const star = percent > 0 ? `<path d="M ${56 + filled} 274 q 3 13 14 16 q -11 3 -14 16 q -3 -13 -14 -16 q 11 -3 14 -16" fill="#f2c879"/>` : "";
  const text = (x: number, y: number, value: string, size: number, color = "#e1e2f7", bold = false) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${bold ? ' font-weight="bold"' : ""}>${escapeXml(value)}</text>`;
  const avatarImage = avatar ? `<image x="914" y="54" width="144" height="144" clip-path="url(#avatar)" href="data:image/png;base64,${avatar.toString("base64")}"/>`
    : `<rect x="914" y="54" width="144" height="144" rx="20" fill="#242c50"/><circle cx="986" cy="104" r="24" fill="#aaa0ce"/><path d="M 937 176 a 49 42 0 0 1 98 0" fill="#aaa0ce"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="560" viewBox="0 0 1120 560">
    <defs>
      <linearGradient id="background" x2="1" y2="1"><stop stop-color="#0b1432"/><stop offset="1" stop-color="#141a39"/></linearGradient>
      <linearGradient id="exp"><stop stop-color="#a5a7ff"/><stop offset="1" stop-color="#9358f7"/></linearGradient>
      <linearGradient id="rank-fill" x2="1" y2="1"><stop stop-color="${rankStyle.background}"/><stop offset="1" stop-color="#151b38"/></linearGradient>
      <clipPath id="avatar"><rect x="914" y="54" width="144" height="144" rx="20"/></clipPath>
      <clipPath id="track"><rect x="56" y="275" width="1008" height="30" rx="15"/></clipPath>
    </defs>
    <rect width="1120" height="560" rx="24" fill="url(#background)"/>
    <rect x="19" y="19" width="1082" height="522" rx="24" fill="none" stroke="#9f87ef" stroke-opacity="0.12" stroke-width="9"/>
    <rect x="19" y="19" width="1082" height="522" rx="24" fill="none" stroke="#ad94f3" stroke-width="2"/>
    <g font-family="${cardFont}, Noto Sans, sans-serif">
      ${text(56, 100, title.text, title.size, "#e1e2f7", true)}
      ${text(56, 163, level.text, level.size, "#e1e2f7", true)}
      ${badges.length ? `<g id="achievement-badges">${badges.map((badge, index) =>
        `<g id="achievement-badge-${index + 1}" data-achievement="${badge.id}" role="img" transform="translate(${880 - (badges.length - index) * 72 + 8} 132)">
          <title>${escapeXml(badge.name)}</title>${achievementIcon(badge.id)}
        </g>`).join("")}</g>` : ""}
      <g id="rank-badge" data-rank-tier="${rankStyle.tier}">
        ${podium ? `<rect x="756" y="56" width="134" height="64" rx="18" fill="none" stroke="${rankStyle.color}" stroke-opacity="0.18" stroke-width="5"/>` : ""}
        <rect x="760" y="60" width="126" height="56" rx="14" fill="url(#rank-fill)" stroke="${rankStyle.color}" stroke-opacity="${podium ? 0.9 : 0.3}" stroke-width="${podium ? 2.5 : 1}"/>
        <text x="823" y="100" text-anchor="middle" font-size="${rank.size}" font-weight="${podium ? "bold" : "normal"}" fill="${rankStyle.color}">${escapeXml(rank.text)}</text>
      </g>
      ${text(56, 207, points.text, points.size, "#b5a2ed")}
      ${avatarImage}<rect x="914" y="54" width="144" height="144" rx="20" fill="none" stroke="#ad94f3" stroke-width="2"/>
      <rect x="49" y="268" width="1022" height="44" rx="22" fill="none" stroke="#ad94f3" stroke-opacity="0.15" stroke-width="7"/>
      <rect x="49" y="268" width="1022" height="44" rx="22" fill="none" stroke="#ad94f3" stroke-width="1.5"/>
      <rect x="56" y="275" width="1008" height="30" rx="15" fill="#202646"/>
      <rect x="56" y="275" width="${filled}" height="30" fill="url(#exp)" clip-path="url(#track)"/>
      ${star}
      ${text(56, 356, experience.text, experience.size)}
      <text x="1064" y="356" text-anchor="end" font-size="29" font-weight="bold" fill="#e1e2f7">${percent}%</text>
      <path d="M 391 406 v 88 M 737 406 v 88" stroke="#8270b6" stroke-opacity="0.7"/>
      <g fill="none" stroke="#ad94f3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 64 412 h 27 l 10 10 v 42 a 5 5 0 0 1 -5 5 h -32 a 5 5 0 0 1 -5 -5 v -47 a 5 5 0 0 1 5 -5 z M 91 412 v 11 h 10 M 77 433 h 14 M 77 445 h 14 M 77 457 h 14"/>
        <circle cx="443" cy="441" r="27"/>
        <path d="M 789 469 c -23 -10 -15 -29 -4 -43 c 5 -7 6 -13 5 -19 c 19 14 19 21 19 29 c 5 -3 9 -9 10 -14 c 20 28 12 47 -10 49"/>
      </g>
      <g fill="#f2c879"><circle cx="69" cy="433" r="2.8"/><circle cx="69" cy="445" r="2.8"/><circle cx="69" cy="457" r="2.8"/>
        <path d="M 430 441 l 9 9 l 18 -20" fill="none" stroke="#f2c879" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M 798 469 c -11 -5 -7 -15 0 -24 c 9 9 13 21 0 24"/>
      </g>
      ${[120, 486, 848].map((x, index) => text(x, 429, labels[index].text, labels[index].size, "#b5a2ed") + text(x, 479, values[index].text, values[index].size, "#e1e2f7", true)).join("")}
    </g>
  </svg>`;
}

export async function renderScoreCard(data: ScoreCardData, avatarUrl?: string): Promise<Buffer> {
  const avatar = await loadAvatar(avatarUrl);
  const svg = await scoreCardSvg(data, avatar);
  // Buffers only: do not persist players' avatars, nicknames or scores on disk.
  return sharp(Buffer.from(svg)).png().toBuffer();
}
