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

test('Armenian routes to the installed Whisper model', () => {
  assertJsonEqual(routing.resolveTranscriptionRoute('hy'), {
    kind: 'switch',
    provider: 'localWhisper',
    model: 'large-v3-turbo-hy',
    requiresWhisperModel: true,
  });
});

test('English and Russian route to Parakeet', () => {
  for (const languageCode of ['en', 'ru']) {
    assertJsonEqual(routing.resolveTranscriptionRoute(languageCode), {
      kind: 'switch',
      provider: 'parakeet',
      model: 'stt-parakeet-multilingual',
      requiresWhisperModel: false,
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
    listWhisperModels: async () => [{ name: 'large-v3-turbo-hy', status: 'Available' }],
    saveTranscriptConfig: async (config) => calls.push(['config', config]),
    saveLanguage: async (languageCode) => calls.push(['language', languageCode]),
  });

  assert.equal(result.status, 'applied');
  assertJsonEqual(calls, [
    ['config', { provider: 'localWhisper', model: 'large-v3-turbo-hy', apiKey: null }],
    ['language', 'hy'],
  ]);
});

test('missing Armenian model does not change settings', async () => {
  const calls = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy',
    currentConfig: { provider: 'parakeet', model: 'stt-parakeet-multilingual', apiKey: null },
    listWhisperModels: async () => [{ name: 'large-v3-turbo-hy', status: 'Missing' }],
    saveTranscriptConfig: async (config) => calls.push(config),
    saveLanguage: async (languageCode) => calls.push(languageCode),
  });

  assertJsonEqual(result, {
    status: 'download-required',
    model: 'large-v3-turbo-hy',
    sizeMb: 1549,
  });
  assertJsonEqual(calls, []);
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

test('Armenian ignores the plain Large V3 model', async () => {
  const calls = [];
  await routing.applyTranscriptionLanguageSelection({
    languageCode: 'hy',
    currentConfig: { provider: 'parakeet', model: 'stt-parakeet-multilingual' },
    listWhisperModels: async () => [
      { name: 'large-v3', status: 'Available' },
      { name: 'small-hy', status: 'Available' },
      { name: 'large-v3-turbo-hy', status: 'Available' },
    ],
    saveTranscriptConfig: async (config) => calls.push(config.model),
    saveLanguage: async () => {},
  });
  assertJsonEqual(calls, ['large-v3-turbo-hy']);
});

test('automatic detection switches away from a fixed Armenian model', async () => {
  const writes = [];
  const result = await routing.applyTranscriptionLanguageSelection({
    languageCode: 'auto',
    currentConfig: { provider: 'parakeet', model: routing.ARMENIAN_PARAKEET_MODEL },
    listWhisperModels: async () => [],
    saveTranscriptConfig: async value => writes.push(value),
    saveLanguage: async value => writes.push(value),
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.config.model, routing.DEFAULT_PARAKEET_MODEL);
  assert.equal(writes[1], 'auto');
});
