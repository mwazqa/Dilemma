export function quizAnswers(payload) {
  if (payload.poll) {
    if (payload.poll.allowMultiselect !== false) throw new Error("Expected a single-choice poll");
    return payload.poll.answers;
  }
  return payload.components[0].toJSON().components.map(button => ({text:button.label.replace(/^\d+\. /,""), ...(button.emoji?{emoji:button.emoji.name}:{})}));
}

export function quizDuration(payload) {
  if (payload.poll) return payload.poll.duration;
  const text=payload.files?.[0]?.description??payload.embeds[0].toJSON().description;
  const expiry=text.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/)[0];
  return Math.round((Date.parse(expiry)-Date.now())/3_600_000);
}
