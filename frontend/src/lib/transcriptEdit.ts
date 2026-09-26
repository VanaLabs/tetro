// Helpers for hand-correcting transcripts: spot a single corrected word, then fix every
// other whole-word occurrence of the same mistake. Unicode-aware, so it works for any language.

const WORD_EDGE = '[\\p{L}\\p{N}\\p{M}]';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const strip = (token: string) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Matches `word` as a whole word (not inside a longer word). */
export function wholeWord(word: string, flags = 'gu') {
  return new RegExp(`(?<!${WORD_EDGE})${escape(word)}(?!${WORD_EDGE})`, flags);
}

/**
 * If the edit replaced one word (or a short phrase) with another and left the rest of the
 * line alone, returns { from, to }. Otherwise null: the edit is a free rewrite.
 */
export function singleWordChange(before: string, after: string): { from: string; to: string } | null {
  const a = before.trim().split(/\s+/), b = after.trim().split(/\s+/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const from = strip(a.slice(start, endA + 1).join(' ')), to = strip(b.slice(start, endB + 1).join(' '));
  if (!from || !to || from === to) return null;
  if (from.split(' ').length > 3 || to.split(' ').length > 3) return null;
  return { from, to };
}

/** Other lines that still contain `from` as a whole word, with their corrected text. */
export function replaceEverywhere(lines: { id: string; text: string }[], from: string, to: string, skipId?: string) {
  const pattern = wholeWord(from);
  return lines
    .filter(line => line.id !== skipId && pattern.test(line.text) && ((pattern.lastIndex = 0), true))
    .map(line => {
      const count = line.text.match(wholeWord(from))?.length ?? 0;
      return { id: line.id, text: line.text.replace(wholeWord(from), to), count };
    });
}
