// Author: TODO - your name | Student ID: TODO - your student ID
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RunStore } from '../src/store.mjs';
import { testConfig } from './helpers.mjs';

test('saved runs survive restart and interrupted generations are marked failed', async t => {
  const config = await testConfig(t, 'http://127.0.0.1:1');
  const store = new RunStore(config.dataDir);
  await store.initialize();
  const id = randomUUID();
  await store.save({ id, status: 'running', stages: [{ status: 'running' }], usage: { apiCalls: 1 } });
  const restarted = new RunStore(config.dataDir);
  await restarted.initialize();
  const run = await restarted.get(id);
  assert.equal(run.status, 'failed');
  assert.equal(run.stages[0].status, 'interrupted');
  assert.equal(run.usage.apiCalls, 1);
  assert.match(run.error, /server stopped/);
  assert.equal(await store.get(randomUUID()), null);
  assert.throws(() => store.filename('../escape'));
});
