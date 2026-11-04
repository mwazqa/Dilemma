export type PastQuestion = {
  id: string;
  source: "topic" | "random";
  question: string;
  correctAnswer: string;
  createdAt: Date;
  topicId?: string;
};

const ignoredWords = new Set("a an the is are was were of to in on at for from by with which what who where when how this that these those does do did has have its it and or usually known most którego ktorego która ktora które ktore który ktory tych tego tym jest są sa był byl była byla były byly jak jaki jaka jakie kiedy gdzie czym czy co ile oraz lub przez przy pod nad dla ze za się sie ma mają maja zwykle najbardziej nazwę nazwe nazywa".split(" "));
const genericAnswers = new Set(["yes", "no", "true", "false", "tak", "nie", "prawda", "falsz"]);

export function normalizeQuestion(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ł/gi, "l").toLowerCase()
    .replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/")
    .replace(/[^\p{L}\p{N}+*/=<>%\-]+/gu, " ").trim();
}

function terms(value: string): Set<string> {
  return new Set(normalizeQuestion(value).split(" ").filter(word => word.length > 1 && !ignoredWords.has(word))
    .map(word => word.length > 5 ? word.slice(0, 5) : word));
}

export class QuestionNoveltyIndex {
  private readonly exact = new Set<string>();
  private readonly postings = new Map<string, Set<number>>();
  private readonly answers = new Map<string, Set<number>>();
  private readonly answerRoots = new Map<string, Set<number>>();
  private readonly documents: { row: PastQuestion; terms: Set<string> }[];

  constructor(readonly history: PastQuestion[]) {
    this.documents = history.map(row => ({ row, terms: terms(row.question + " " + row.correctAnswer) }));
    this.documents.forEach(({ row, terms: features }, index) => {
      this.exact.add(normalizeQuestion(row.question));
      for (const feature of features) {
        const matches = this.postings.get(feature) ?? new Set<number>();
        matches.add(index); this.postings.set(feature, matches);
      }
      const answer = normalizeQuestion(row.correctAnswer);
      if (!/\p{L}{2}/u.test(answer) || genericAnswers.has(answer)) return;
      const matches = this.answers.get(answer) ?? new Set<number>();
      matches.add(index); this.answers.set(answer, matches);
      for (const feature of terms(answer)) {
        if (feature.length < 4) continue;
        const root = feature.slice(0, 4), related = this.answerRoots.get(root) ?? new Set<number>();
        related.add(index); this.answerRoots.set(root, related);
      }
    });
  }

  hasExact(question: string): boolean { return this.exact.has(normalizeQuestion(question)); }
  reject(question: string): void { this.exact.add(normalizeQuestion(question)); }

  candidates(question: string, correctAnswer: string): PastQuestion[] {
    const features = terms(question + " " + correctAnswer);
    const sameAnswer = this.answers.get(normalizeQuestion(correctAnswer)) ?? new Set<number>();
    const answerRelated = new Set<number>();
    const matches = new Map<number, number>();
    for (const feature of features) {
      const posting = this.postings.get(feature);
      if (!posting) continue;
      const weight = 1 + Math.log((this.documents.length + 1) / (posting.size + 1));
      for (const index of posting) matches.set(index, (matches.get(index) ?? 0) + weight);
    }
    for (const index of sameAnswer) matches.set(index, (matches.get(index) ?? 0) + 10);
    for (const feature of features) {
      if (feature.length < 4) continue;
      for (const index of this.answerRoots.get(feature.slice(0, 4)) ?? []) answerRelated.add(index);
    }
    for (const index of answerRelated) matches.set(index, (matches.get(index) ?? 0) + 6);
    return [...matches].flatMap(([index, score]) => {
      const document = this.documents[index];
      const overlap = [...features].filter(feature => document.terms.has(feature)).length;
      const smaller = Math.min(features.size, document.terms.size);
      if (!sameAnswer.has(index) && !answerRelated.has(index) && (overlap < 2 || overlap / Math.max(1, smaller) < 0.3)) return [];
      return [{ row: document.row, score }];
    }).sort((a, b) => b.score - a.score || +b.row.createdAt - +a.row.createdAt).slice(0, 5).map(item => item.row);
  }

  prompt(topicId?: string, rejected: string[] = []): string[] {
    const preferred = topicId ? this.history.filter(row => row.topicId === topicId).slice(0, 12) : [];
    const recent = this.history.slice(0, preferred.length ? 8 : 20);
    const selected = new Set<string>();
    for (const group of [rejected, recent.map(row => row.question), preferred.map(row => row.question)]) {
      for (const question of group) { selected.add(question); if (selected.size === 20) return [...selected].map(value => value.slice(0, 300)); }
    }
    for (const row of this.history) { selected.add(row.question); if (selected.size === 20) break; }
    return [...selected].map(question => question.slice(0, 300));
  }
}

const publicationQueues = new Map<string, Promise<void>>();

export async function withQuestionPublication<T>(guildId: string, publish: () => Promise<T>): Promise<T> {
  const previous = publicationQueues.get(guildId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  publicationQueues.set(guildId, tail);
  await previous;
  try { return await publish(); }
  finally {
    release();
    if (publicationQueues.get(guildId) === tail) publicationQueues.delete(guildId);
  }
}
