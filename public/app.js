// Author: TODO - your name | Student ID: TODO - your student ID

/** Get a required element by its stable DOM ID. */
function element(id) { return document.getElementById(id); }

const form = element('generation-form');
const description = element('description');
const requirements = element('requirements');
const generate = element('generate');
let files = [];
let pollingVersion = 0;

/** Read an API response and surface server validation messages. */
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

/** Convert one requirement per line into the request contract. */
function requirementLines() {
  return requirements.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** Keep the visible requirement count in sync with the editable input. */
function updateCount() {
  const count = requirementLines().length;
  element('requirement-count').textContent = `${count} requirement${count === 1 ? '' : 's'}`;
}

/** Display a form-level error using text rather than interpreting HTML. */
function showError(message) {
  element('form-error').textContent = message;
  element('form-error').hidden = !message;
}

/** Reflect whether a generation is in progress without blocking input edits. */
function setBusy(busy) {
  generate.disabled = busy;
  element('generate-label').textContent = busy ? 'Generating your application…' : 'Generate application';
  form.setAttribute('aria-busy', String(busy));
}

/** Check the configured local model without making an LLM generation call. */
async function checkModel() {
  element('check-model').disabled = true;
  element('model-health').textContent = 'Checking connection…';
  try {
    const health = await api('/api/model-health');
    element('model-name').textContent = health.model;
    element('model-health').textContent = !health.reachable ? 'Ollama unavailable — start Ollama to generate.' :
      health.installed ? 'Connected · model installed' : 'Ollama connected · configured model not installed';
  } catch (error) { element('model-health').textContent = error.message; }
  finally { element('check-model').disabled = false; }
}

/** Load the selected Medical Symptom Tracker description and concrete requirements. */
async function loadExample() {
  try {
    const example = await api('/api/example');
    description.value = example.description;
    requirements.value = example.requirements.join('\n');
    updateCount();
    showError('');
  } catch (error) { showError(error.message); }
}

/** Render a generated file as inert, selectable source text. */
function showFile() {
  const file = files.find(item => item.path === element('file-picker').value);
  element('file-content').textContent = file?.content || '';
}

/** Render statuses, measured usage, and downloadable files from a persisted run. */
function renderRun(run) {
  const badge = element('run-badge');
  badge.className = `badge ${run.status}`;
  badge.textContent = { queued: 'Queued', running: 'Generating', completed: 'Project ready', failed: 'Needs attention' }[run.status];
  run.stages.forEach((stage, index) => {
    const row = element(`stage-${index}`);
    row.className = stage.status;
    row.querySelector('.stage-status').textContent = {
      pending: 'Waiting', running: 'Working', completed: 'Done', failed: 'Failed', interrupted: 'Interrupted',
    }[stage.status];
    row.querySelector('.stage-icon').textContent = stage.status === 'completed' ? '✓' : String(index + 1);
  });
  const usage = run.usage;
  element('api-calls').textContent = usage.apiCalls.toLocaleString();
  element('input-tokens').textContent = usage.inputTokens.toLocaleString();
  element('output-tokens').textContent = usage.outputTokens.toLocaleString();
  element('total-tokens').textContent = usage.totalTokens.toLocaleString();
  element('usage-note').hidden = !usage.unreportedCalls;
  element('usage-note').textContent = `${usage.unreportedCalls} call(s) did not report token usage. Counts above are known tokens only, not a complete total.`;
  const message = element('run-message');
  message.className = `run-message ${run.status}`;
  message.textContent = run.status === 'failed' ? run.error : run.status === 'completed' ?
    'Application and test files generated. Download the project to run them.' :
    'Agents are working through MCP. You can leave this page open; progress is saved locally.';
  const complete = run.status === 'completed';
  element('empty-state').hidden = complete;
  element('results').hidden = !complete;
  if (complete) {
    files = run.files;
    const picker = element('file-picker');
    picker.replaceChildren(...files.map(file => new Option(file.path, file.path)));
    showFile();
    element('download').href = `/api/runs/${run.id}/download`;
  }
}

/** Resume polling after refresh and retry transient connection failures automatically. */
async function pollRun(id, version) {
  if (version !== pollingVersion) return;
  try {
    const run = await api(`/api/runs/${id}`);
    if (version !== pollingVersion) return;
    renderRun(run);
    const busy = ['queued', 'running'].includes(run.status);
    setBusy(busy);
    if (busy) setTimeout(() => pollRun(id, version), 1200);
  } catch (error) {
    if (version !== pollingVersion) return;
    element('run-message').textContent = `Could not refresh progress: ${error.message} Retrying…`;
    setTimeout(() => pollRun(id, version), 3000);
  }
}

/** Submit user requirements once and start following the returned generation. */
async function submit(event) {
  event.preventDefault();
  showError('');
  const lines = requirementLines();
  if (!lines.length || lines.length > 30 || lines.some(line => line.length < 3 || line.length > 1000)) {
    showError('Enter 1–30 requirements, each containing 3–1000 characters.');
    return;
  }
  setBusy(true);
  try {
    const { id } = await api('/api/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.value.trim(), requirements: lines }),
    });
    try { localStorage.setItem('ai-coder-last-run', id); } catch { /* Private browser storage can be unavailable. */ }
    pollingVersion += 1;
    await pollRun(id, pollingVersion);
  } catch (error) {
    showError(error.message);
    setBusy(false);
  }
}

/** Initialize model information and restore a saved run when available. */
async function initialize() {
  try {
    const config = await api('/api/config');
    element('model-name').textContent = config.model;
    await checkModel();
    let id;
    try { id = localStorage.getItem('ai-coder-last-run'); } catch { /* Storage is optional. */ }
    if (id && /^[0-9a-f-]{36}$/.test(id)) {
      try {
        const run = await api(`/api/runs/${id}`);
        description.value = run.request.description;
        requirements.value = run.request.requirements.join('\n');
        updateCount();
        pollingVersion += 1;
        await pollRun(id, pollingVersion);
      } catch { /* A deleted local run should not prevent starting a new one. */ }
    }
  } catch (error) { showError(error.message); }
}

requirements.addEventListener('input', updateCount);
form.addEventListener('submit', submit);
element('load-example').addEventListener('click', loadExample);
element('check-model').addEventListener('click', checkModel);
element('file-picker').addEventListener('change', showFile);
initialize();
