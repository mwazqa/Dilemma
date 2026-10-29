import sharp from "sharp";
import { cardFont, escapeXml } from "./score-card.js";

const width = 1400;
const margin = 90;
const gap = 26;

async function textBlock(value: string, available: number, size: number, bold = false) {
  return sharp({ text: { text: `<span foreground="#f2f0ff">${escapeXml(value.replace(/[\r\n\t]+/g, " "))}</span>`,
    font: `${cardFont} ${bold ? "Bold " : ""}${size}`, width: available, align: "centre", wrap: "word-char", rgba: true } })
    .png().toBuffer({ resolveWithObject: true });
}

export async function renderQuizCard(question: string, options: string[], hours: number): Promise<Buffer> {
  if (!question.trim() || question.length > 300 || options.length < 2 || options.length > 4 ||
      options.some(option => !option.trim() || option.length > 55) || !Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("Invalid quiz card data");
  let title = await textBlock(question, width - margin * 2, 64, true);
  for (let size = 60; title.info.height > 290 && size >= 30; size -= 4) title = await textBlock(question, width - margin * 2, size, true);
  const cellWidth = (width - margin * 2 - gap) / 2;
  const answers = await Promise.all(options.map((option, index) => textBlock(`${index + 1}. ${option}`, cellWidth - 50, 44, true)));
  const rowHeight = Math.max(116, ...answers.map(answer => answer.info.height + 48));
  const gridTop = 146 + title.info.height + 46;
  const rows = Math.ceil(options.length / 2);
  const height = Math.max(560, gridTop + rows * rowHeight + (rows - 1) * gap + 88);
  const positions = options.map((_, index) => ({ x: options.length === 3 && index === 2 ? (width - cellWidth) / 2
    : margin + (index % 2) * (cellWidth + gap), y: gridTop + Math.floor(index / 2) * (rowHeight + gap) }));
  const spark = (x: number, y: number, size: number) => `<path d="M ${x} ${y - size} Q ${x} ${y} ${x + size} ${y} Q ${x} ${y} ${x} ${y + size} Q ${x} ${y} ${x - size} ${y} Q ${x} ${y} ${x} ${y - size}" fill="#f2c879"/>`;
  const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="navy" x2="1" y2="1"><stop stop-color="#0b1432"/><stop offset="1" stop-color="#141a39"/></linearGradient>
    <clipPath id="frame"><rect x="4" y="4" width="1392" height="${height - 8}" rx="28"/></clipPath></defs>
    <rect x="4" y="4" width="1392" height="${height - 8}" rx="28" fill="url(#navy)" stroke="#ad94f3" stroke-width="2.5"/>
    <g clip-path="url(#frame)" fill="none" stroke="#ad94f3" stroke-opacity="0.5">
      <path d="M -60 210 C 210 220 350 110 430 -30 M -60 170 C 150 210 310 70 355 -30"/>
      <path d="M 960 ${height + 30} C 1030 ${height - 105} 1310 ${height - 48} 1470 ${height - 260} M 1030 ${height + 30} C 1120 ${height - 90} 1350 ${height - 70} 1450 ${height - 210}"/>
    </g><g fill="none" stroke="#f2c879" stroke-opacity="0.65"><path d="M -25 205 C 145 220 270 115 335 55 M 1050 ${height + 10} C 1160 ${height - 95} 1320 ${height - 15} 1440 ${height - 190}"/></g>
    ${spark(56, 158, 14)}${spark(337, 54, 17)}${spark(1045, 54, 6)}${spark(1348, height - 175, 17)}${spark(1190, height - 43, 14)}${spark(58, height - 54, 6)}
    <rect x="1160" y="35" width="178" height="65" rx="32" fill="#10152c" stroke="#ad94f3" stroke-width="2"/>
    <g fill="none" stroke="#b9a5ec" stroke-width="4" stroke-linecap="round"><circle cx="1193" cy="67" r="14"/><path d="M 1193 57 V 67 L 1200 71"/></g>
    ${positions.map(position => `<rect x="${position.x}" y="${position.y}" width="${cellWidth}" height="${rowHeight}" rx="23" fill="#12172f" fill-opacity="0.7" stroke="#ad94f3" stroke-width="2"/>`).join("")}
  </svg>`;
  const timer = await textBlock(`${hours} h`, 96, 34, true);
  return sharp(Buffer.from(background)).composite([
    { input: title.data, left: Math.round((width - title.info.width) / 2), top: 146 },
    { input: timer.data, left: 1223, top: Math.round(67 - timer.info.height / 2) },
    ...answers.map((answer, index) => ({ input: answer.data, left: Math.round(positions[index].x + (cellWidth - answer.info.width) / 2),
      top: Math.round(positions[index].y + (rowHeight - answer.info.height) / 2) }))
  ]).png().toBuffer();
}
