// Author: TODO - your name | Student ID: TODO - your student ID
import { z } from 'zod';

export const requestSchema = z.object({
  description: z.string().trim().min(10).max(6000),
  requirements: z.array(z.string().trim().min(3).max(1000)).min(1).max(30),
}).strict();

export const planSchema = z.object({
  name: z.string().min(1).max(100),
  summary: z.string().min(1).max(3000),
  requirements: z.array(z.object({
    id: z.string().regex(/^REQ-\d+$/),
    description: z.string().min(1).max(1500),
    acceptance: z.string().min(1).max(1500),
  }).strict()).min(1).max(40),
  modules: z.array(z.object({
    path: z.string().min(1).max(150),
    purpose: z.string().min(1).max(1000),
  }).strict()).min(1).max(25),
}).strict();

export const fileSchema = z.object({
  path: z.string().min(1).max(150),
  content: z.string().min(1).max(200000),
}).strict();
export const filesSchema = z.object({ files: z.array(fileSchema).min(1).max(30) }).strict();

/** Build a strict JSON schema for Ollama structured output. */
function object(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const string = { type: 'string' };
export const planFormat = object({
  name: string,
  summary: string,
  requirements: { type: 'array', items: object({ id: string, description: string, acceptance: string }) },
  modules: { type: 'array', items: object({ path: string, purpose: string }) },
});
export const filesFormat = object({
  files: { type: 'array', items: object({ path: string, content: string }) },
});

/** Reject paths that are unsafe or ambiguous on Windows, Linux, or inside ZIPs. */
export function validateFilePath(value) {
  const segments = value.split('/');
  if (!/^[a-zA-Z0-9_.\-/]+$/.test(value) || segments.some(segment =>
    !segment || segment === '.' || segment === '..' || segment.startsWith('.') ||
    segment.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
    /^(node_modules|data)$/i.test(segment)
  )) throw new Error(`Unsupported generated file path: ${value}`);
  return value;
}

/** Validate a bundle, including case-insensitive duplicates and size limits. */
export function validateFiles(files) {
  const seen = new Set();
  let size = 0;
  for (const file of files) {
    validateFilePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate generated file: ${file.path}`);
    seen.add(key);
    size += Buffer.byteLength(file.content);
  }
  if (size > 1500000) throw new Error('Generated project exceeds the 1.5 MB limit.');
  for (const key of seen) {
    const parts = key.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join('/'))) throw new Error('A generated file conflicts with a directory.');
    }
  }
  return files;
}
