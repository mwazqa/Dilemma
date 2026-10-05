import OpenAI from "openai";
import { env } from "../config.js";
import { questionSchema, type Question } from "../types/question.js";

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export async function generateQuestion(topic: string, language = "en"): Promise<Question> {
  if (!client) throw new Error("OPENAI_API_KEY is not configured");

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: "Create one accurate, inclusive multiple-choice quiz question about " + topic +
      " in " + language + ". Return JSON with language, topic, question, options, correctOption and explanation."
  });

  return questionSchema.parse(JSON.parse(response.output_text));
}
