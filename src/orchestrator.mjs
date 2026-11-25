// Author: TODO - your name | Student ID: TODO - your student ID
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { addUsage, emptyUsage } from './model.mjs';
import { buildBundle, checkJavaScript } from './bundle.mjs';
import { filesSchema, planSchema } from './contracts.mjs';

const agents = [
  { name: 'Requirements planner', tool: 'plan_application' },
  { name: 'Application developer', tool: 'implement_application' },
  { name: 'Test writer', tool: 'create_tests' },
];

/** Coordinate sequential agent handoffs over a real MCP stdio session. */
export class Orchestrator {
  /** Share configuration and persistence; allow one local generation at a time. */
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.active = false;
  }

  /** Persist a queued run before returning its identifier to the UI. */
  async submit(request) {
    if (this.active) throw Object.assign(new Error('A generation is already running. Wait for it to finish.'), { status: 409 });
    this.active = true;
    const run = {
      id: randomUUID(), request, model: this.config.model, status: 'queued',
      createdAt: new Date().toISOString(), finishedAt: null, error: null,
      usage: emptyUsage(), plan: null, files: [],
      stages: agents.map(agent => ({ ...agent, status: 'pending', usage: emptyUsage() })),
      verification: { javascriptSyntax: 'not_checked', testsExecuted: false },
    };
    try { await this.store.save(run); }
    catch (error) { this.active = false; throw error; }
    this.completion = this.execute(run).finally(() => { this.active = false; });
    // A storage failure must be logged, not become an unhandled rejection.
    this.completion.catch(error => console.error('Could not persist generation:', error.message));
    return run.id;
  }

  /** Start the MCP agent server, forward shared context, and save each completed handoff. */
  async execute(run) {
    const config = this.config;
    const client = new Client({ name: 'ai-coder-orchestrator', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))],
      stderr: 'pipe',
      env: {
        OLLAMA_BASE_URL: config.ollamaBaseUrl, OLLAMA_MODEL: config.model,
        LLM_TIMEOUT_MS: String(config.timeoutMs),
        LLM_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens),
        LLM_CONTEXT_TOKENS: String(config.contextTokens),
      },
    });
    transport.stderr?.on('data', chunk => console.error('[MCP]', chunk.toString().trim()));
    try {
      run.status = 'running';
      await this.store.save(run);
      await client.connect(transport);
      const { tools } = await client.listTools();
      for (const agent of agents) {
        if (!tools.some(tool => tool.name === agent.tool)) throw new Error(`MCP tool unavailable: ${agent.tool}`);
      }
      let applicationFiles;
      let testFiles;
      for (const stage of run.stages) {
        stage.status = 'running';
        await this.store.save(run);
        const input = { ...run.request };
        if (run.plan) input.plan = run.plan;
        if (applicationFiles && stage.tool === 'create_tests') input.files = applicationFiles;
        const reply = await client.callTool({ name: stage.tool, arguments: input }, undefined, {
          timeout: config.timeoutMs + 15000,
        });
        const content = reply.content?.find(item => item.type === 'text');
        if (!content) throw new Error('MCP agent returned no text result.');
        const payload = JSON.parse(content.text);
        if (payload.usage) {
          stage.usage = payload.usage;
          addUsage(run.usage, payload.usage);
        }
        if (reply.isError || !payload.ok) throw new Error(payload.error || 'MCP agent failed.');
        if (stage.tool === 'plan_application') run.plan = planSchema.parse(payload.result);
        if (stage.tool === 'implement_application') {
          applicationFiles = filesSchema.parse(payload.result).files;
          await checkJavaScript(applicationFiles);
        }
        if (stage.tool === 'create_tests') {
          testFiles = filesSchema.parse(payload.result).files;
          await checkJavaScript(testFiles);
        }
        stage.status = 'completed';
        await this.store.save(run);
      }
      run.files = buildBundle(run, applicationFiles, testFiles, config);
      run.verification.javascriptSyntax = 'passed';
      run.status = 'completed';
    } catch (error) {
      run.status = 'failed';
      run.error = error.message;
      for (const stage of run.stages) if (stage.status === 'running') stage.status = 'failed';
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      run.finishedAt = new Date().toISOString();
      await this.store.save(run);
    }
  }
}
