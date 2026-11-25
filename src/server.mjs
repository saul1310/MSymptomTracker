// Author: TODO - your name | Student ID: TODO - your student ID
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, loadConfig } from './config.mjs';
import { requestSchema } from './contracts.mjs';
import { RunStore } from './store.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { zipBundle } from './bundle.mjs';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

/** Send a JSON response with cache prevention for run data. */
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

/** Bound request size before parsing untrusted JSON. */
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Use Content-Type: application/json.'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 48000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

/** Create the local UI/API server; dependency injection keeps integration tests realistic. */
export async function createApp(config = loadConfig()) {
  const store = new RunStore(config.dataDir);
  await store.initialize();
  const orchestrator = new Orchestrator(config, store);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      // The app is local-only. Reject foreign Host/Origin values rather than expose model access.
      const host = request.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(response, 403, { error: 'Local access only.' });
      if (request.headers.origin && ![`http://${host}`, `https://${host}`].includes(request.headers.origin)) {
        return json(response, 403, { error: 'Cross-origin requests are not allowed.' });
      }
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'GET' && assets[url.pathname]) {
        const [filename, contentType] = assets[url.pathname];
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        return response.end(await readFile(path.join(ROOT, 'public', filename)));
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json(response, 200, { model: config.model, provider: 'Ollama', active: orchestrator.active });
      }
      if (request.method === 'GET' && url.pathname === '/api/example') {
        return json(response, 200, JSON.parse(await readFile(path.join(ROOT, 'examples', 'medical-symptom-tracker.json'), 'utf8')));
      }
      if (request.method === 'GET' && url.pathname === '/api/model-health') {
        try {
          const reply = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
          if (!reply.ok) throw new Error('Model service did not respond successfully.');
          const body = await reply.json();
          const models = (body.models || []).map(model => model.name);
          const installed = models.includes(config.model) || models.includes(`${config.model}:latest`);
          return json(response, 200, { reachable: true, installed, model: config.model, models });
        } catch {
          return json(response, 200, { reachable: false, installed: false, model: config.model, models: [] });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const parsed = requestSchema.safeParse(await readJson(request));
        if (!parsed.success) return json(response, 400, { error: 'Enter a description (10–6000 characters) and 1–30 requirements (3–1000 characters each).' });
        const id = await orchestrator.submit(parsed.data);
        return json(response, 202, { id });
      }
      const match = /^\/api\/runs\/([0-9a-f-]{36})(\/download)?$/.exec(url.pathname);
      if (request.method === 'GET' && match) {
        const run = await store.get(match[1]);
        if (!run) return json(response, 404, { error: 'Generation not found.' });
        if (match[2]) {
          if (run.status !== 'completed') return json(response, 409, { error: 'This generation has no completed project to download.' });
          const zip = zipBundle(run.files);
          response.writeHead(200, {
            'Content-Type': 'application/zip', 'Content-Length': zip.byteLength,
            'Content-Disposition': `attachment; filename="generated-project-${run.id.slice(0, 8)}.zip"`,
            'Cache-Control': 'no-store',
          });
          return response.end(zip);
        }
        return json(response, 200, run);
      }
      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (!error.status) console.error('Request failed:', error.message);
      json(response, error.status || 500, { error: error.status ? error.message : 'An internal error occurred. Check the server terminal.' });
    }
  });
  return { server, orchestrator, store };
}

// Importing the server for tests does not start a listener.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = loadConfig();
  const { server } = await createApp(config);
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`AI Coder: http://127.0.0.1:${server.address().port}`);
    console.log(`Model: ${config.model} via Ollama. Generated projects are stored in data/.`);
  });
}
