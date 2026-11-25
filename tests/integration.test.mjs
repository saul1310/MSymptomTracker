// Author: TODO - your name | Student ID: TODO - your student ID
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../src/server.mjs';
import { fakeOllama, testConfig } from './helpers.mjs';

const execute = promisify(execFile);
const request = { description: 'A small medical symptom tracker.', requirements: ['Validate symptom severity from 1 to 10.'] };

/** Run the real web API and real MCP subprocess against a deterministic test model. */
async function application(t, options) {
  const model = await fakeOllama(t, options);
  const config = await testConfig(t, model.url);
  config.studentName = 'Test Student';
  config.studentId = '123456';
  const app = await createApp(config);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    await app.orchestrator.completion;
    await new Promise(resolve => { app.server.closeAllConnections(); app.server.close(resolve); });
  });
  return { ...app, model, config, url: `http://127.0.0.1:${app.server.address().port}` };
}

/** Submit through HTTP rather than bypassing input validation or orchestration. */
async function submit(url, body = request) {
  return fetch(`${url}/api/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('UI → real MCP agents → ZIP → executable application and corresponding tests', { timeout: 30000 }, async t => {
  const app = await application(t);
  const page = await fetch(app.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Define your application/);
  const health = await (await fetch(`${app.url}/api/model-health`)).json();
  assert.equal(health.installed, true);
  const submitted = await submit(app.url);
  assert.equal(submitted.status, 202);
  const { id } = await submitted.json();
  const duplicate = await submit(app.url);
  assert.equal(duplicate.status, 409);
  await app.orchestrator.completion;
  const run = await (await fetch(`${app.url}/api/runs/${id}`)).json();
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.stages.every(stage => stage.status === 'completed'), true);
  assert.deepEqual(run.usage, { apiCalls: 3, inputTokens: 33, outputTokens: 21, totalTokens: 54, unreportedCalls: 0 });
  assert.equal(run.verification.testsExecuted, false);
  assert.equal(app.model.calls.length, 3);
  assert.equal(app.model.calls[0].stream, false);
  assert.deepEqual(app.model.calls[0].format.type, 'object');
  const developerInput = JSON.parse(app.model.calls[1].messages[1].content);
  const testerInput = JSON.parse(app.model.calls[2].messages[1].content);
  assert.equal(developerInput.plan.name, run.plan.name);
  assert.equal(testerInput.files.some(file => file.path === 'domain.mjs'), true);
  assert.deepEqual(testerInput.requirements, request.requirements);

  const download = await fetch(`${app.url}/api/runs/${id}/download`);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  const archive = unzipSync(new Uint8Array(await download.arrayBuffer()));
  assert.match(strFromU8(archive['domain.mjs']), /Author: Test Student \| Student ID: 123456/);
  assert.equal(JSON.parse(strFromU8(archive['generation-report.json'])).usage.totalTokens, 54);
  const destination = path.join(app.config.dataDir, 'downloaded');
  for (const [filename, content] of Object.entries(archive)) {
    const absolute = path.join(destination, filename);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  const generatedEnvironment = { ...process.env };
  // A nested Node test runner must not inherit its parent's child-runner context.
  delete generatedEnvironment.NODE_TEST_CONTEXT;
  const result = await execute(process.execPath, ['--test', '--test-reporter=tap', 'tests/domain.test.mjs'], {
    cwd: destination, env: generatedEnvironment,
  });
  assert.match(result.stdout, /# pass 1/);

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: destination, env: { ...generatedEnvironment, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Generated application did not start.')), 5000);
      child.once('error', reject);
      child.stdout.on('data', chunk => {
        const match = /PORT=(\d+)/.exec(chunk.toString());
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const generatedPage = await fetch(`http://127.0.0.1:${port}`);
    assert.match(await generatedPage.text(), /Symptom entries/);
  } finally {
    // Release the child's working directory before Windows removes the temp project.
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }
});

test('failed agent preserves usage, stops later agents, and blocks download', { timeout: 20000 }, async t => {
  const app = await application(t, { failAt: 1 });
  const { id } = await (await submit(app.url)).json();
  await app.orchestrator.completion;
  const run = await app.store.get(id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /HTTP 500/);
  assert.equal(run.usage.apiCalls, 2);
  assert.equal(run.usage.totalTokens, 18);
  assert.equal(run.usage.unreportedCalls, 1);
  assert.equal(run.stages[2].status, 'pending');
  assert.equal((await fetch(`${app.url}/api/runs/${id}/download`)).status, 409);
  assert.equal(app.orchestrator.active, false);
});

test('unsafe generated paths fail the run before a downloadable artifact is exposed', { timeout: 20000 }, async t => {
  const app = await application(t, {
    mutate: (value, index) => index === 1 ? { files: [{ path: '../escape.mjs', content: 'export const x = 1;' }] } : value,
  });
  const { id } = await (await submit(app.url)).json();
  await app.orchestrator.completion;
  const run = await app.store.get(id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Unsupported generated file path/);
  assert.equal(run.files.length, 0);
});

test('API rejects invalid inputs, foreign origins, missing runs, and static path traversal', async t => {
  const app = await application(t);
  assert.equal((await submit(app.url, { description: '', requirements: [] })).status, 400);
  assert.equal((await fetch(`${app.url}/api/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify(request),
  })).status, 403);
  assert.equal((await fetch(`${app.url}/api/runs/00000000-0000-0000-0000-000000000000`)).status, 404);
  assert.equal((await fetch(`${app.url}/src/config.mjs`)).status, 404);
  assert.equal(app.model.calls.length, 0);
});
