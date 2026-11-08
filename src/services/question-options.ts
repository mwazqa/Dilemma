import { randomInt } from "node:crypto";
import type { Question } from "../types/question.js";

export function shuffleQuestionOptions(question: Question, nextIndex: (max: number) => number = randomInt): Question {
  const order = question.options.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = nextIndex(index + 1);
    [order[index], order[target]] = [order[target], order[index]];
  }
  return {
    ...question,
    options: order.map(index => question.options[index]),
    optionEmojis: order.map(index => question.optionEmojis[index]),
    correctOption: order.indexOf(question.correctOption)
  };
}
