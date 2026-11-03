import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
Object.assign(process.env, { DOTENV_CONFIG_PATH: resolve(".tools/disabled-guide-docs.env"),
  DATABASE_URL: "postgresql://guide:guide@127.0.0.1:1/dilemma_guide", DATABASE_URL_UNPOOLED: "",
  DISCORD_TOKEN: "test", DISCORD_CLIENT_ID: "test", OPENAI_API_KEY: "test" });
const { getPlayerGuideText } = await import("../dist/services/player-guide.js");
const { messageLanguages } = await import("../dist/messages.js");
const { db } = await import("../dist/db.js");
try {
  const guides = messageLanguages.map(language => ({ language, content: getPlayerGuideText(language) + "\n" }));
  if (guides.some(guide => guide.content.replace(/\n/g, "\r\n").length > 4000)) throw new RangeError("Guide exceeds message budget");
  for (const { language, content } of guides) writeFileSync(resolve(`docs/player-guide.${language}.md`), content);
  console.log(JSON.stringify({ check: "guide-documents", passed: true, locales: guides.length,
    characters: Object.fromEntries(guides.map(guide => [guide.language, guide.content.length])) }));
} catch {
  console.error(JSON.stringify({ check: "guide-documents", passed: false, category: "document-generation" }));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
