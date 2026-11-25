// Author: TODO - your name | Student ID: TODO - your student ID
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

/** Walk project-owned source directories without inspecting dependencies or user data. */
async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sources(filename));
    else files.push(filename);
  }
  return files;
}

for (const directory of ['src', 'public', 'scripts', 'tests']) {
  for (const filename of await sources(path.join(ROOT, directory))) {
    if (/\.(mjs|js)$/.test(filename)) execFileSync(process.execPath, ['--check', filename], { stdio: 'pipe' });
    if (/\.(mjs|js|css|html)$/.test(filename)) {
      const content = await readFile(filename, 'utf8');
      if (!content.split('\n')[0].includes('Student ID:')) throw new Error(`Missing attribution header: ${filename}`);
    }
    if (filename.endsWith('.json')) JSON.parse(await readFile(filename, 'utf8'));
  }
}
console.log('Source syntax and attribution headers checked.');
