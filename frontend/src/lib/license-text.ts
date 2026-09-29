/** Reflow plain-text notice paragraphs without changing their words or list boundaries. */
export function reflowLicenseText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/).map((block) => {
    const lines = block.split('\n').map(line => line.trim());
    // Attribution, package headings and ASCII separators are separate records.
    const record = (line: string) => /^(?:Copyright\b|©|[─=\-]{3,}$)/i.test(line)
      || / — (?:LICEN[CS]E|COPYING|NOTICE)\b/i.test(line);
    const listItem = (line: string) => /^(?:[-*•] |\(?\d+(?:\.\d+)*[.)] |\([a-z]\) )/.test(line);
    return lines.reduce((result, line, index) => {
      if (!index) return line;
      return result + (record(line) || record(lines[index - 1]) || listItem(line) ? '\n' : ' ') + line;
    }, '');
  }).join('\n\n');
}
