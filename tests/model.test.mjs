// Author: TODO - your name | Student ID: TODO - your student ID
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateJson, emptyUsage } from '../src/model.mjs';
import { planSchema, planFormat } from '../src/contracts.mjs';
import { fakeOllama, testConfig } from './helpers.mjs';

const input = { system: 'Plan an application.', input: {}, schema: planSchema, format: planFormat };

test('usage uses provider counts and preserves them when model JSON is invalid', async t => {
  const model = await fakeOllama(t, { mutate: () => 'not valid JSON' });
  const config = await testConfig(t, model.url);
  const usage = emptyUsage();
  await assert.rejects(generateJson(config, input, usage), /invalid JSON/);
  assert.deepEqual(usage, { apiCalls: 1, inputTokens: 11, outputTokens: 7, totalTokens: 18, unreportedCalls: 0 });
});

test('missing provider usage is unknown rather than an invented zero-token success', async t => {
  const model = await fakeOllama(t, { missingUsage: true });
  const config = await testConfig(t, model.url);
  const usage = emptyUsage();
  await generateJson(config, input, usage);
  assert.equal(usage.apiCalls, 1);
  assert.equal(usage.unreportedCalls, 1);
  assert.equal(usage.totalTokens, 0);
});

test('provider errors retain attempted call count and a useful error', async t => {
  const model = await fakeOllama(t, { failAt: 0 });
  const config = await testConfig(t, model.url);
  const usage = emptyUsage();
  await assert.rejects(generateJson(config, input, usage), /HTTP 500/);
  assert.equal(usage.apiCalls, 1);
  assert.equal(usage.unreportedCalls, 1);
});
