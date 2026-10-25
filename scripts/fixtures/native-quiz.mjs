export function quizAnswers(payload) {
  if (!payload.poll || payload.poll.allowMultiselect !== false) throw new Error("Expected a native single-choice poll");
  return payload.poll.answers;
}

export function quizDuration(payload) {
  if (!payload.poll) throw new Error("Expected a native poll");
  return payload.poll.duration;
}
