// Author: TODO - your name | Student ID: TODO - your student ID
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { requestSchema, validateFilePath, validateFiles } from '../src/contracts.mjs';
import { loadConfig } from '../src/config.mjs';
import { checkJavaScript } from '../src/bundle.mjs';
import { testConfig } from './helpers.mjs';

test('input validation rejects empty, excessive, and unexpected requirements', () => {
  assert.equal(requestSchema.safeParse({ description: 'A symptom tracker', requirements: ['Save entries'] }).success, true);
  for (const requirements of [[], [''], Array(31).fill('Save entries')]) {
    assert.equal(requestSchema.safeParse({ description: 'A symptom tracker', requirements }).success, false);
  }
  assert.equal(requestSchema.safeParse({ description: 'A symptom tracker', requirements: ['Save entries'], command: 'run' }).success, false);
});

test('generated paths reject traversal, Windows special paths, and ZIP collisions', () => {
  for (const filename of ['../secret', '/root.txt', 'C:/file', 'tests\\bad.mjs', '.env', 'public//a', 'CON.txt', 'aux', 'data/records.json', 'node_modules/a.js', 'a./b']) {
    assert.throws(() => validateFilePath(filename), filename);
  }
  assert.equal(validateFilePath('tests/domain.test.mjs'), 'tests/domain.test.mjs');
  assert.throws(() => validateFiles([{ path: 'A.js', content: 'a' }, { path: 'a.js', content: 'b' }]));
  assert.throws(() => validateFiles([{ path: 'public', content: 'a' }, { path: 'public/index.html', content: 'b' }]));
});

test('configuration rejects invalid limits and credential-bearing URLs', () => {
  assert.throws(() => loadConfig({ PORT: 'invalid' }));
  assert.throws(() => loadConfig({ OLLAMA_BASE_URL: 'file:///tmp/model' }));
  assert.throws(() => loadConfig({ OLLAMA_BASE_URL: 'https://user:secret@example.com' }));
  assert.throws(() => loadConfig({ LLM_TIMEOUT_MS: '-1' }));
});

test('syntax checking does not execute generated code and identifies invalid files', async t => {
  const config = await testConfig(t, 'http://127.0.0.1:1');
  const marker = path.join(config.dataDir, 'must-not-exist');
  await checkJavaScript([{ path: 'safe.mjs', content: `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');` }]);
  await assert.rejects(access(marker));
  await assert.rejects(checkJavaScript([{ path: 'broken.mjs', content: 'export function {' }]), /broken.mjs/);
});
