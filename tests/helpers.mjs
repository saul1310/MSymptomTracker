// Author: TODO - your name | Student ID: TODO - your student ID
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

/** Start an ephemeral loopback server and register deterministic test cleanup. */
export async function listen(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/** Create an isolated data directory and configure a model endpoint for a test. */
export async function testConfig(t, modelUrl) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-coder-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { ...loadConfig({}), dataDir: directory, ollamaBaseUrl: modelUrl, model: 'test-model', timeoutMs: 10000 };
}

/** Supply deterministic model responses exclusively for integration tests. */
export function modelFixtures() {
  return [
    {
      name: 'Symptom entry example', summary: 'A small symptom logging example.',
      requirements: [{ id: 'REQ-01', description: 'Validate symptom severity.', acceptance: 'Accept 1–10 and reject other values.' }],
      modules: [{ path: 'domain.mjs', purpose: 'Validate symptom entries.' }, { path: 'server.mjs', purpose: 'Serve a local UI.' }],
    },
    { files: [
      { path: 'domain.mjs', content: `/** Validate and return one symptom entry. */
export function createEntry(name, severity) {
  if (!name.trim() || !Number.isInteger(severity) || severity < 1 || severity > 10) throw new Error('Invalid entry');
  return { name: name.trim(), severity };
}\n` },
      { path: 'server.mjs', content: `import http from 'node:http';
import { readFile } from 'node:fs/promises';
/** Return the generated browser page. */
async function handler(request, response) {
  response.setHeader('Content-Type', 'text/html');
  response.end(await readFile(new URL('./public/index.html', import.meta.url)));
}
const server = http.createServer(handler);
server.listen(Number(process.env.PORT || 3100), '127.0.0.1', () => console.log('PORT=' + server.address().port));\n` },
      { path: 'public/index.html', content: '<!doctype html><html lang="en"><title>Symptom entries</title><h1>Symptom entries</h1></html>' },
    ] },
    { files: [{ path: 'tests/domain.test.mjs', content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../domain.mjs';
/** Exercise valid severities and invalid boundaries against actual application exports. */
test('validates symptom severity', () => {
  assert.deepEqual(createEntry(' Pain ', 1), { name: 'Pain', severity: 1 });
  assert.equal(createEntry('Pain', 10).severity, 10);
  for (const severity of [0, 11, 1.5]) assert.throws(() => createEntry('Pain', severity));
  assert.throws(() => createEntry('', 5));
});\n` }] },
  ];
}

/** Emulate only Ollama's HTTP contract, leaving the real MCP client/server untouched. */
export async function fakeOllama(t, { failAt = -1, mutate, missingUsage = false } = {}) {
  const calls = [];
  const fixtures = modelFixtures();
  const listener = await listen(t, async (request, response) => {
    if (request.url === '/api/tags') {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ models: [{ name: 'test-model' }] }));
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    calls.push(body);
    const index = calls.length - 1;
    response.setHeader('Content-Type', 'application/json');
    if (index === failAt) {
      response.writeHead(500);
      return response.end(JSON.stringify({ error: 'test failure' }));
    }
    const value = mutate ? mutate(fixtures[index], index) : fixtures[index];
    response.end(JSON.stringify({
      done: true, done_reason: 'stop',
      message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) },
      ...(!missingUsage && { prompt_eval_count: 11, eval_count: 7 }),
    }));
  });
  return { ...listener, calls };
}
