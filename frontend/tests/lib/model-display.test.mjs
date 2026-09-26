import assert from 'node:assert/strict';
import test from 'node:test';
import { parakeetDisplayName, summaryDisplayName, whisperDisplayName } from '../../src/lib/model-display.ts';

test('bundled transcription names state language coverage and model family', () => {
  const ids = ['stt-parakeet-multilingual', 'stt-parakeet-english', 'stt-fastconformer-armenian'];
  for (const id of ids) {
    const label = parakeetDisplayName(id);
    assert.match(label, /^(Multilingual|English|Armenian) · (Parakeet|NVIDIA FastConformer)/);
  }
  assert.match(parakeetDisplayName('personal-model'), /^Language coverage unknown ·/);
});

test('Whisper variants distinguish compression without changing model IDs', () => {
  assert.equal(whisperDisplayName('tiny'), 'Multilingual · Whisper Tiny · standard');
  assert.equal(whisperDisplayName('tiny-q5_1'), 'Multilingual · Whisper Tiny · compressed Q5_1');
  assert.match(whisperDisplayName('large-v3-turbo-hy'), /^Armenian, English, Russian · Whisper/);
  assert.match(whisperDisplayName('personal-model'), /^Language coverage unknown · Whisper/);
});

test('summary labels include the model family and size', () => {
  assert.equal(summaryDisplayName('qwen3.5:2b'), 'Multilingual · Qwen 3.5 · 2B · Q4_K_M');
  assert.equal(summaryDisplayName('gemma3:1b'), 'Multilingual · Gemma 3 · 1B · Q8_0');
});
