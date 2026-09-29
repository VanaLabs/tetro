import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { reflowLicenseText } from '../../src/lib/license-text';

test('notice paragraphs reflow while attributions and lists remain separate', () => {
  expect(reflowLicenseText('Permission to obtain a copy\nof this software.\n\nCopyright (c) A\nCopyright (c) B\n\n1. Keep this\nnotice.\n2. Keep that.'))
    .toBe('Permission to obtain a copy of this software.\n\nCopyright (c) A\nCopyright (c) B\n\n1. Keep this notice.\n2. Keep that.');
});

test('reflow preserves every word of the bundled third-party notices', () => {
  const original = readFileSync(new URL('../../public/tetro/licenses.txt', import.meta.url), 'utf8');
  const words = (value: string) => value.trim().split(/\s+/);
  expect(words(reflowLicenseText(original))).toEqual(words(original));
  expect(reflowLicenseText(original)).toContain('identity artwork are reserved to Vana Labs.');
});
