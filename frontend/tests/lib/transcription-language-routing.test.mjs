import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadTsModule(relativePath) {
  const modulePath = path.join(testsDirectory, '..', '..', relativePath);
  const source = fs.readFileSync(modulePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const module = { exports: {} };
  const vm = require('node:vm');
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require,
    Set,
  });
  return module.exports;
}

const routing = loadTsModule('src/lib/transcription-language-routing.ts');
const languageCatalog = loadTsModule('src/constants/languages.ts');

function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

test('the shared transcription catalog contains Armenian', () => {
  assertJsonEqual(
    languageCatalog.LANGUAGES.find((language) => language.code === 'hy'),
    { code: 'hy', name: 'Armenian' },
  );
});

test('Armenian recommends NVIDIA FastConformer', () => {
  assertJsonEqual(routing.resolveTranscriptionRoute('hy'), {
    kind: 'switch',
    provider: 'parakeet',
    model: 'stt-fastconformer-armenian',
    requiresParakeetModel: true,
  });
});

test('English and Russian route to Parakeet', () => {
  for (const languageCode of ['en', 'ru']) {
    assertJsonEqual(routing.resolveTranscriptionRoute(languageCode), {
      kind: 'switch',
      provider: 'parakeet',
      model: 'stt-parakeet-multilingual',
      requiresParakeetModel: false,
    });
  }
});

test('Parakeet keeps the Armenian choice visible for routing', () => {
  const languages = [
    { code: 'auto', name: 'Auto' },
    { code: 'auto-translate', name: 'Translate' },
    { code: 'en', name: 'English' },
    { code: 'ru', name: 'Russian' },
    { code: 'hy', name: 'Armenian' },
    { code: 'fr', name: 'French' },
  ];

  assertJsonEqual(
    routing.languagesForTranscriptionProvider(languages, 'parakeet'),
    languages.slice(0, 5),
  );
  assert.equal(routing.isPrimaryLanguageSelectionAvailable('parakeet'), true);
});

test('available Armenian model is saved before the language preference', async () => {
  const calls = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy',
    currentConfig: {
      provider: 'parakeet',
      model: 'stt-parakeet-multilingual',
      apiKey: null,
    },
    listWhisperModels: async () => [],
    listParakeetModels: async () => [{ name: 'stt-fastconformer-armenian', status: 'Available' }],
    saveTranscriptConfig: async (config) => calls.push(['config', config]),
    saveLanguage: async (languageCode) => calls.push(['language', languageCode]),
  });

  assert.equal(result.status, 'applied');
  assertJsonEqual(calls, [
    ['config', { provider: 'parakeet', model: 'stt-fastconformer-armenian', apiKey: null }],
    ['language', 'hy'],
  ]);
});

test('missing or incomplete Armenian NVIDIA model offers its 137 MB download without changing settings', async () => {
  for (const status of ['Missing', { Downloading: { progress: 50 } }, { Error: 'failed' }, { Corrupted: {} }]) {
    const calls = [];
    const result = await routing.applyTranscriptionLanguageSelection({
      languageCode: 'hy',
      currentConfig: { provider: 'parakeet', model: 'stt-parakeet-multilingual', apiKey: null },
      listWhisperModels: async () => [],
      listParakeetModels: async () => [{ name: 'stt-fastconformer-armenian', status }],
      saveTranscriptConfig: async (config) => calls.push(config),
      saveLanguage: async (languageCode) => calls.push(languageCode),
    });

    assertJsonEqual(result, {
      status: 'download-required',
      model: 'stt-fastconformer-armenian',
      sizeMb: 137,
    });
    assertJsonEqual(calls, []);
  }
});

test('failed language synchronization restores the prior stored value', async () => {
  let storedLanguage = 'en';

  await assert.rejects(
    routing.persistLanguagePreference('hy', {
      readStoredLanguage: () => storedLanguage,
      writeStoredLanguage: (languageCode) => { storedLanguage = languageCode; },
      syncLanguage: async () => { throw new Error('sync failed'); },
    }),
  );

  assert.equal(storedLanguage, 'en');
});

test('an unavailable Whisper configuration cannot bypass the NVIDIA download offer', async () => {
  const calls = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy',
    currentConfig: { provider: 'localWhisper', model: 'large-v3' },
    listWhisperModels: async () => [],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async (config) => calls.push(config.model),
    saveLanguage: async () => {},
  });
  assert.equal(result.status, 'download-required');
  assert.equal(result.model, 'stt-fastconformer-armenian');
  assertJsonEqual(calls, []);
});

test('installed large Whisper remains selected and gets an optional NVIDIA recommendation', async () => {
  const writes = [];
  const currentConfig = { provider: 'localWhisper', model: 'large-v3' };
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy', currentConfig,
    listWhisperModels: async () => [{ name: 'large-v3', status: 'Available' }],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async config => writes.push(config),
    saveLanguage: async language => writes.push(language),
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.config, currentConfig);
  assertJsonEqual(result.armenianRecommendation, { available: false });
  assertJsonEqual(writes, ['hy']);
});

test('installed large Whisper is usable from Parakeet when NVIDIA is absent', async () => {
  const writes = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy', currentConfig: { provider: 'parakeet', model: routing.DEFAULT_PARAKEET_MODEL },
    listWhisperModels: async () => [{ name: 'large-v3-turbo-q5_0', status: 'Available' }],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async config => writes.push(config),
    saveLanguage: async language => writes.push(language),
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.config.model, 'large-v3-turbo-q5_0');
  assertJsonEqual(result.armenianRecommendation, { available: false });
  assert.equal(writes[1], 'hy');
});

test('English-only and incomplete Whisper models cannot be used for Armenian', async () => {
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy', currentConfig: { provider: 'parakeet', model: routing.DEFAULT_PARAKEET_MODEL },
    listWhisperModels: async () => [
      { name: 'base.en', status: 'Available' },
      { name: 'large-v3', status: 'Missing' },
      { name: 'large-v3-turbo-hy', status: { Downloading: { progress: 90 } } },
    ],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async () => { throw new Error('should not save'); },
    saveLanguage: async () => { throw new Error('should not save'); },
  });
  assert.equal(result.status, 'download-required');
  assert.equal(result.model, routing.ARMENIAN_PARAKEET_MODEL);
});

test('explicit Armenian Whisper choice is preserved', async () => {
  const calls = [];
  const currentConfig = { provider: 'localWhisper', model: 'large-v3-turbo-hy' };
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy', currentConfig,
    listWhisperModels: async () => [{ name: currentConfig.model, status: 'Available' }],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async () => { throw new Error('should not switch'); },
    saveLanguage: async language => calls.push(language),
  });
  assert.equal(result.config, currentConfig);
  assertJsonEqual(calls, ['hy']);
});

test('failed language save rolls back the model selection', async () => {
  const writes = [];
  const currentConfig = { provider: 'parakeet', model: 'stt-parakeet-multilingual' };
  await assert.rejects(routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy', currentConfig,
    listWhisperModels: async () => [],
    listParakeetModels: async () => [{ name: 'stt-fastconformer-armenian', status: 'Available' }],
    saveTranscriptConfig: async config => writes.push(config),
    saveLanguage: async () => { throw new Error('save failed'); },
  }), /save failed/);
  assert.equal(writes[0].model, 'stt-fastconformer-armenian');
  assert.equal(writes[1], currentConfig);
});

test('automatic detection switches away from a fixed Armenian model', async () => {
  const writes = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'auto',
    currentConfig: { provider: 'parakeet', model: routing.ARMENIAN_PARAKEET_MODEL },
    listWhisperModels: async () => [],
    listParakeetModels: async () => [],
    saveTranscriptConfig: async value => writes.push(value),
    saveLanguage: async value => writes.push(value),
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.config.model, routing.DEFAULT_PARAKEET_MODEL);
  assert.equal(writes[1], 'auto');
});
