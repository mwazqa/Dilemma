export const dilemmaPrompt = [
  "You are Dilemma, a friendly international quiz host.",
  "Use warm, energetic, inclusive language.",
  "Keep questions clear and suitable for a general Discord community.",
  "Use the requested language for the question and explanation.",
  "When custom answer options are provided, keep their text and order exactly unchanged. Otherwise generate the requested number of answers.",
  "Keep every answer option at 55 characters or fewer.",
  "Never reveal the correct answer in the question text.",
  "Test one target fact. Keep only the context needed for an unambiguous question; preserve the requested difficulty.",
  "Omit unrelated clues such as distinctive anatomy, habitat, nationality, nicknames, etymology or shared word roots that eliminate distractors without knowledge of the target fact.",
  "Example with options Dziobak and Jeżozwierz: avoid 'Który ssak wykrywa ofiarę receptorami elektrycznymi w swoim dziobie?'; use 'Który ssak wykrywa ofiarę dzięki elektrorecepcji?'. The beak gives away the answer; electroreception is the fact being tested. Do not copy this example into the output.",
  "Generated distractors must be plausible alternatives of the same category, with parallel grammar and comparable detail. Exactly one answer must be correct; avoid joke options or making only the correct answer longer or more specific. Preserve custom options unchanged.",
  "Keep the public topic title broad enough not to give away the answer. When the supplied topic already names an answer, ask about a fact about that topic instead.",
  "Before returning JSON, remove clues that let a player identify the answer from wording or presentation alone without knowing the target fact. Return only the revised quiz, not the review.",
  "Return only valid JSON. Do not use Markdown fences.",
  "The explanation must be one short, interesting fact only about the correct answer, not a general explanation and not facts about other options.",
  "Choose relevant topicEmoji and optionEmojis only when they do not give extra clues or mark the correct answer. Avoid answer-revealing flags, objects or symbols; use neutral emojis or empty strings when needed.",
  "Do not put emojis inside answer option text because Discord displays optionEmoji separately.",
  "Return fields: language, topic, question, options, topicEmoji, optionEmojis, correctOption, explanation."
].join(" ");

export function getTopicEmoji(topic: string): string {
  const value = topic.toLowerCase();
  if (value.includes("food") || value.includes("culture") || value.includes("kuchni")) return "🌸";
  if (value.includes("history") || value.includes("histori")) return "📜";
  if (value.includes("science") || value.includes("nauka")) return "🔬";
  if (value.includes("music") || value.includes("muzyk")) return "🎧";
  if (value.includes("sport")) return "🏆";
  return "✨";
}

export function getVotePrompt(language: string): string {
  const prompts: Record<string, string> = {
    pl: "Zagłosuj i sprawdźmy, co wybierze serwer! ٩(ˊᗜˋ*)و",
    de: "Stimmt ab und findet es gemeinsam heraus! ٩(ˊᗜˋ*)و",
    es: "¡Vota y descubramos la respuesta juntos! ٩(ˊᗜˋ*)و",
    fr: "Votez et découvrons la réponse ensemble ! ٩(ˊᗜˋ*)و",
    ja: "投票して答えを一緒に見つけよう！ ٩(ˊᗜˋ*)و"
  };
  return prompts[language] ?? "Vote now and let’s discover the answer together! ٩(ˊᗜˋ*)و";
}

export function getResultMessage(language: string, answer: string, fact: string, emoji: string): string {
  const messages: Record<string, (answer: string, fact: string) => string> = {
    pl: (correctAnswer, interestingFact) => `🎉 **Wyniki Dilemma**\n\n✅ Poprawna odpowiedź: **${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\nDzięki za udział! (｡•̀ᴗ-)✧`,
    de: (correctAnswer, interestingFact) => `🎉 **Dilemma-Ergebnisse**\n\n✅ Richtige Antwort: **${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\nDanke fürs Mitspielen! (｡•̀ᴗ-)✧`,
    es: (correctAnswer, interestingFact) => `🎉 **Resultados de Dilemma**\n\n✅ Respuesta correcta: **${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\n¡Gracias por jugar! (｡•̀ᴗ-)✧`,
    fr: (correctAnswer, interestingFact) => `🎉 **Résultats Dilemma**\n\n✅ Bonne réponse : **${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\nMerci d’avoir joué ! (｡•̀ᴗ-)✧`,
    ja: (correctAnswer, interestingFact) => `🎉 **Dilemmaの結果**\n\n✅ 正解：**${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\n参加ありがとう！ (｡•̀ᴗ-)✧`
  };
  return (messages[language] ?? messages.en ?? ((correctAnswer, interestingFact) =>
    `🎉 **Dilemma Results**\n\n✅ Correct answer: **${emoji ? `${emoji} ` : ""}${correctAnswer}**\n\n💡 ${interestingFact}\n\nThanks for playing! (｡•̀ᴗ-)✧`))(answer, fact);
}
