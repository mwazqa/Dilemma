import assert from "node:assert/strict";
import { shuffleQuestionOptions } from "../dist/services/question-options.js";

function choices(count) {
  if (count < 2) return [[]];
  return choices(count - 1).flatMap(rest => Array.from({ length: count }, (_, index) => [index, ...rest]));
}

let checked = 0;
for (const count of [2, 3, 4]) {
  const paths = choices(count);
  for (let correctOption = 0; correctOption < count; correctOption += 1) {
    const question = Object.freeze({ language: "pl", topic: "Test", question: "Synthetic question?",
      options: Object.freeze(["Pierwsza", "Druga", "Trzecia", "Czwarta"].slice(0, count)),
      optionEmojis: Object.freeze(["🍎", "🍐", "🍋", "🍇"].slice(0, count)), correctOption,
      topicEmoji: "", explanation: "Synthetic fact." });
    const permutations = new Set(), positions = Array(count).fill(0);
    for (const path of paths) {
      const remaining = [...path];
      let max = count;
      const shuffled = shuffleQuestionOptions(question, bound => {
        assert.equal(bound, max--);
        return remaining.shift();
      });
      assert.equal(remaining.length, 0);
      assert.equal(shuffled.options[shuffled.correctOption], question.options[correctOption]);
      assert.deepEqual([...shuffled.options].sort(), [...question.options].sort());
      assert.deepEqual(shuffled.optionEmojis, shuffled.options.map(option => question.optionEmojis[question.options.indexOf(option)]));
      assert.deepEqual({ ...shuffled, options: question.options, optionEmojis: question.optionEmojis, correctOption }, question);
      assert.notEqual(shuffled.options, question.options);
      assert.notEqual(shuffled.optionEmojis, question.optionEmojis);
      permutations.add(JSON.stringify(shuffled.options));
      positions[shuffled.correctOption]++;
      checked++;
    }
    assert.equal(permutations.size, paths.length, "Every permutation has exactly one equally likely draw path");
    assert.deepEqual(positions, Array(count).fill(paths.length / count), "Every correct-answer position is equally likely");
    const random = shuffleQuestionOptions(question);
    assert.equal(random.options[random.correctOption], question.options[correctOption]);
    assert.deepEqual([...random.options].sort(), [...question.options].sort());
  }
}
console.log(`PASS: ${checked} answer permutations, uniform positions, preserved correct answers, emojis and immutable input`);
