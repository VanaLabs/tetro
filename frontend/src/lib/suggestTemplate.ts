// Picks the template whose wording best matches a transcript. Local and instant; only
// suggests when one template clearly wins, so a weak guess never shows.

export type TemplateText = { id: string; name: string; description: string; sections?: { title: string; instruction: string }[] };

const STOP = new Set('the a an and or of to in on for with at by from is are was were be been it this that these those as we you i they he she our your their what who how when which will would should can could do does did not no yes so if then than there here about into over also just more most some any each per its via meeting meetings notes note summary list include including key'.split(' '));
const words = (text: string) => (text.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]{2,}/gu) ?? []).filter(w => !STOP.has(w));
const stem = (w: string) => w.replace(/(ings|ing|ies|es|s|ed)$/u, '');

export function suggestTemplate(transcript: string, templates: TemplateText[]): { id: string; score: number } | null {
  if (words(transcript).length < 40 || templates.length < 2) return null;
  const counts = new Map<string, number>();
  for (const w of words(transcript)) counts.set(stem(w), (counts.get(stem(w)) ?? 0) + 1);
  const scored = templates.map(t => {
    const vocab = new Set(words([t.name, t.description, ...(t.sections ?? []).flatMap(s => [s.title, s.instruction])].join(' ')).map(stem));
    const matched = [...vocab].filter(v => counts.has(v));
    // Share of the template's own vocabulary heard in the meeting, weighted by how often.
    const weight = matched.reduce((n, v) => n + Math.min(counts.get(v) ?? 0, 4), 0);
    return { id: t.id, distinct: matched.length, score: (matched.length / Math.max(vocab.size, 1)) * Math.log2(1 + weight) };
  }).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  // At least three different template words heard, and a clear lead over the runner-up.
  return best.distinct >= 3 && best.score > next.score * 1.4 ? { id: best.id, score: best.score } : null;
}
