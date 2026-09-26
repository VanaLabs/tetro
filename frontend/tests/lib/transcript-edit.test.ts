import { describe, expect, test } from 'bun:test';
import { replaceEverywhere, singleWordChange } from '../../src/lib/transcriptEdit';

describe('transcript corrections', () => {
  test('spots a single corrected word, ignoring punctuation', () => {
    expect(singleWordChange('Thanks, Jonh.', 'Thanks, John.')).toEqual({ from: 'Jonh', to: 'John' });
    expect(singleWordChange('meet the Acme team', 'meet the ACME team')).toEqual({ from: 'Acme', to: 'ACME' });
    expect(singleWordChange('Բարև Արամ', 'Բարև Արման')).toEqual({ from: 'Արամ', to: 'Արման' });
  });

  test('treats rewrites as free edits', () => {
    expect(singleWordChange('we should ship it on friday', 'the release moves to next week instead')).toBeNull();
    expect(singleWordChange('same text', 'same text')).toBeNull();
  });

  test('replaces whole words only, in any script', () => {
    const lines = [{ id: '1', text: 'Jonh said hi' }, { id: '2', text: 'Jonhson and Jonh' }, { id: '3', text: 'nothing' }, { id: '4', text: 'Արամ, Արամը' }];
    expect(replaceEverywhere(lines, 'Jonh', 'John', '1')).toEqual([{ id: '2', text: 'Jonhson and John', count: 1 }]);
    expect(replaceEverywhere(lines, 'Արամ', 'Արման')).toEqual([{ id: '4', text: 'Արման, Արամը', count: 1 }]);
  });
});
