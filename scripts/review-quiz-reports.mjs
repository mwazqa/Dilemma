import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const action = process.argv[2] ?? "pending";
  const input = { action };
  if (action === "ack" || action === "deliver") {
    const directory = realpathSync(path.join(root, ".tools/quiz-report-reviews"));
    const file = realpathSync(path.resolve(root, process.argv[3] ?? ""));
    const relative = path.relative(directory, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !file.endsWith(".json") || statSync(file).size > 128000) throw Error("input");
    const review = JSON.parse(readFileSync(file, "utf8"));
    input.reviews = review.reviews;
    if (action === "deliver") input.messages = review.messages;
  } else if (action !== "pending") throw Error("input");
  const config = JSON.parse(readFileSync(path.join(root, ".deploy.production.json"), "utf8"));
  if (![config.key, config.user, config.host].every(value => typeof value === "string" && value.length > 0)) throw Error("configuration");
  if (action === "deliver") {
    if (!/^\d{17,20}$/.test(config.quizReportRecipientId ?? "")) throw Error("recipient");
    input.recipientId = config.quizReportRecipientId;
  }
  const code = `import {db} from './dist/db.js';
try {
  if (!db.quizReport) console.log(JSON.stringify({status:'not-deployed'}));
  else {
    const input=JSON.parse(${JSON.stringify(JSON.stringify(input))});
    const {reviewQuizReports,deliverQuizReportReview}=await import('./scripts/lib/quiz-report-review.mjs');
    if(input.action==='deliver') {
      const {REST,Routes}=await import('discord.js');
      const {env}=await import('./dist/config.js');
      const {message}=await import('./dist/messages.js');
      const api=new REST({version:'10',timeout:15000}).setToken(env.DISCORD_TOKEN);
      let channel;
      const send=async body=>{
        channel??=await api.post(Routes.userChannels(),{body:{recipient_id:input.recipientId}});
        await api.post(Routes.channelMessages(channel.id),{body});
      };
      console.log(JSON.stringify(await deliverQuizReportReview(db,input,send,message('pl','quizReportReviewIntro',{count:input.reviews?.length??0}))));
    } else console.log(JSON.stringify(await reviewQuizReports(db,input)));
  }
} catch(error) {
  console.log(JSON.stringify({status:error?.code==='P2021'?'not-deployed':'unavailable'}));
  if(error?.code!=='P2021')process.exitCode=1;
} finally {await db.$disconnect();}`;
  const result = spawnSync("ssh.exe", ["-i", config.key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=15", `${config.user}@${config.host}`, "sudo -n docker exec -i dilemma node --input-type=module"],
  { input: code, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 2000000 });
  if (result.status !== 0) throw Error("connection");
  const value = JSON.parse(result.stdout);
  if (!["ready", "not-deployed", "acknowledged", "delivered", "already-delivered", "conflict", "invalid", "unavailable"].includes(value.status)) throw Error("response");
  console.log(JSON.stringify(value, null, 2));
  if (["invalid", "unavailable", "conflict"].includes(value.status)) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ status: "unavailable", category: "report-review" }));
  process.exitCode = 1;
}
