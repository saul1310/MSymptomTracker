// Author: TODO - your name | Student ID: TODO - your student ID
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Persist run snapshots atomically inside the ignored local data directory. */
export class RunStore {
  /** Bind the store to its own configured root. */
  constructor(directory) { this.directory = directory; }

  /** Reject any run identifier that could escape the storage directory. */
  filename(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid run ID.');
    return path.join(this.directory, `${id}.json`);
  }

  /** Create storage and mark runs interrupted by an earlier server shutdown. */
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const run = await this.get(name.slice(0, -5));
      if (run && ['queued', 'running'].includes(run.status)) {
        run.status = 'failed';
        run.error = 'The server stopped before this run completed. Submit a new generation.';
        run.finishedAt = new Date().toISOString();
        for (const stage of run.stages) if (stage.status === 'running') stage.status = 'interrupted';
        await this.save(run);
      }
    }
  }

  /** Replace a snapshot only after the complete JSON file is written. */
  async save(run) {
    const filename = this.filename(run.id);
    await writeFile(`${filename}.tmp`, JSON.stringify(run, null, 2), 'utf8');
    await rename(`${filename}.tmp`, filename);
  }

  /** Read a saved run or return null when the run does not exist. */
  async get(id) {
    try { return JSON.parse(await readFile(this.filename(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}
