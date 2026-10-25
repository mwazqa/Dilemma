import { escapeMarkdown } from "discord.js";

export function inlineText(value: string): string {
  return escapeMarkdown(value.replace(/[\r\n\u2028\u2029]+/gu, " "));
}

export function bulletList(items: string[]): string {
  return items.map(item => `- ${item}`).join("\n");
}

export function textPages(blocks: string[], limit = 2000): string[] {
  if (!Number.isInteger(limit) || limit < 2 || limit > 2000) throw new RangeError("Invalid message size");
  const pages: string[] = [];
  let page = "";
  for (const block of blocks.filter(Boolean)) {
    if (page && page.length + block.length + 2 <= limit) { page += `\n\n${block}`; continue; }
    if (page) { pages.push(page); page = ""; }
    let remaining = block;
    while (remaining.length > limit) {
      let end = remaining.lastIndexOf("\n", limit);
      if (end < 1) end = limit;
      if (/[\uD800-\uDBFF]/u.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/u.test(remaining[end])) end--;
      pages.push(remaining.slice(0, end));
      remaining = remaining.slice(end + (remaining[end] === "\n" ? 1 : 0));
    }
    page = remaining;
  }
  if (page) pages.push(page);
  return pages;
}
