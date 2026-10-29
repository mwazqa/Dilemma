import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
Object.assign(process.env,{DATABASE_URL:"postgresql://test:test@127.0.0.1:1/dilemma_test",DISCORD_TOKEN:"test",DISCORD_CLIENT_ID:"test",OPENAI_API_KEY:"test"});
const {renderQuizCard}=await import("../dist/services/quiz-card.js");
const {quizVotingPayload}=await import("../dist/services/quiz-voting.js");
const {db}=await import("../dist/db.js");
const preview=process.argv.includes("--preview");
try{
  if(preview)mkdirSync(".tools/quiz-card-preview",{recursive:true});
  for(const count of [2,3,4]){
    const options=["48","54","56","64"].slice(0,count);
    const card=await renderQuizCard("Ile wynosi 7 × 8?",options,6);
    const metadata=await sharp(card).metadata();
    assert.equal(metadata.format,"png");assert.equal(metadata.width,1400);assert.ok(metadata.height>=560&&metadata.height<=1200);
    if(preview)writeFileSync(`.tools/quiz-card-preview/${count}-answers.png`,card);
  }
  const question=("Które z podanych stwierdzeń opisuje poprawnie wskazane zjawisko? ".repeat(5)).slice(0,300);
  const options=["Odpowiedź pierwsza ","Odpowiedź druga ","Odpowiedź trzecia ","Odpowiedź czwarta "].map(value=>value.repeat(4).slice(0,55));
  const expiry=new Date(Date.now()+21_600_000);
  const payload=await quizVotingPayload({question,options,optionEmojis:options.map(()=>"")},expiry,"pl");
  assert.equal(payload.files.length,1);assert.equal(payload.embeds[0].toJSON().description,undefined);assert.equal(payload.embeds[0].toJSON().footer,undefined);
  assert.ok(payload.files[0].description.includes(question));
  for(const option of options)assert.ok(payload.files[0].description.includes(option));
  assert.ok(payload.files[0].description.length<=1024);
  if(preview)writeFileSync(".tools/quiz-card-preview/long-question.png",payload.files[0].attachment);
  const japanese=await renderQuizCard("世界の歴史と科学について正しい説明を選んでください。".repeat(12).slice(0,300),["科学の説明についての回答".repeat(5).slice(0,55),"別の説明についての回答".repeat(5).slice(0,55)],24);
  assert.equal((await sharp(japanese).metadata()).width,1400);
  if(preview)writeFileSync(".tools/quiz-card-preview/japanese.png",japanese);
  const escaped=await renderQuizCard("Który zapis zawiera <, > oraz &?",["<image href='x'>","A & B"],1);
  assert.equal((await sharp(escaped).metadata()).format,"png");
  const originalPng=sharp.prototype.png;
  try{
    sharp.prototype.png=function(){throw new Error("Injected renderer failure");};
    const fallback=await quizVotingPayload({question,options,optionEmojis:options.map(()=>"")},expiry,"pl");
    assert.equal(fallback.files.length,0);assert.ok(fallback.embeds[0].toJSON().description.includes(question));assert.equal(fallback.components.length,3);
  }finally{sharp.prototype.png=originalPng;}
  console.log(JSON.stringify({check:"quiz-card",passed:true,layouts234:true,fullLongText:true,cjk:true,xmlEscaped:true,textFallback:true}));
}catch(error){console.error(JSON.stringify({check:"quiz-card",passed:false,category:error instanceof assert.AssertionError?"assertion":"test-error",line:Number(error.stack?.match(/test-quiz-card\.mjs:(\d+)/)?.[1]??0)}));process.exitCode=1;}
finally{await db.$disconnect();}
