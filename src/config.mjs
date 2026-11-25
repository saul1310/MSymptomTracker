// Author: TODO - your name | Student ID: TODO - your student ID
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Parse a bounded integer setting and fail early on invalid configuration. */
function integer(env, key, fallback, minimum, maximum) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

/** Load local-only service settings without sending credentials to the browser. */
export function loadConfig(env = process.env) {
  const url = new URL(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OLLAMA_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  return {
    port: integer(env, 'PORT', 3000, 0, 65535),
    ollamaBaseUrl: url.href.replace(/\/$/, ''),
    model: env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    timeoutMs: integer(env, 'LLM_TIMEOUT_MS', 600000, 100, 3600000),
    maxOutputTokens: integer(env, 'LLM_MAX_OUTPUT_TOKENS', 16000, 128, 65536),
    contextTokens: integer(env, 'LLM_CONTEXT_TOKENS', 32768, 2048, 131072),
    studentName: env.STUDENT_NAME || 'TODO - your name',
    studentId: env.STUDENT_ID || 'TODO - your student ID',
    dataDir: path.resolve(ROOT, 'data'),
  };
}
