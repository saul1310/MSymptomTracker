// Author: TODO - your name | Student ID: TODO - your student ID
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.mjs';
import { fileSchema, planSchema, requestSchema } from './contracts.mjs';
import { planApplication, implementApplication, createTests } from './agents.mjs';
import { emptyUsage } from './model.mjs';

const config = loadConfig();
const server = new McpServer({ name: 'ai-coder-agents', version: '1.0.0' });

/** Wrap an agent result in MCP content and preserve accounting on every outcome. */
function agentTool(agent) {
  return async (input) => {
    const usage = emptyUsage();
    try {
      const result = await agent(config, input, usage);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result, usage }) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error.message, usage }) }],
      };
    }
  };
}

server.registerTool('plan_application', {
  description: 'Requirements agent: create the shared implementation plan and acceptance criteria.',
  inputSchema: requestSchema.shape,
}, agentTool(planApplication));

server.registerTool('implement_application', {
  description: 'Development agent: consume the requirements agent handoff and generate executable source files.',
  inputSchema: { ...requestSchema.shape, plan: planSchema },
}, agentTool(implementApplication));

server.registerTool('create_tests', {
  description: 'Testing agent: consume the shared plan and developer source, then generate corresponding node:test cases.',
  inputSchema: { ...requestSchema.shape, plan: planSchema, files: z.array(fileSchema).min(1).max(30) },
}, agentTool(createTests));

// stdout is reserved for MCP JSON-RPC; diagnostics belong on stderr.
await server.connect(new StdioServerTransport());
