// Author: TODO - your name | Student ID: TODO - your student ID

/** Track attempted LLM calls and provider-reported tokens, including failed calls. */
export function emptyUsage() {
  return { apiCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, unreportedCalls: 0 };
}

/** Add usage without estimating tokens when the provider did not report them. */
export function addUsage(target, source) {
  for (const key of Object.keys(emptyUsage())) target[key] += source[key] || 0;
  return target;
}

/** Make one real Ollama call and retain usage even when content validation fails. */
export async function generateJson(config, { system, input, format, schema }, usage) {
  usage.apiCalls += 1;
  usage.unreportedCalls += 1;
  let response;
  try {
    response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
        options: { temperature: 0.1, num_predict: config.maxOutputTokens, num_ctx: config.contextTokens },
      }),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('Model request timed out. Increase LLM_TIMEOUT_MS or use a smaller model.');
    throw new Error('Cannot reach Ollama. Start Ollama and check OLLAMA_BASE_URL in .env.');
  }
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}. Check that OLLAMA_MODEL is installed (ollama list).`);
  }
  const body = await response.json();
  if (Number.isInteger(body.prompt_eval_count) && body.prompt_eval_count >= 0 &&
      Number.isInteger(body.eval_count) && body.eval_count >= 0) {
    usage.inputTokens += body.prompt_eval_count;
    usage.outputTokens += body.eval_count;
    usage.totalTokens += body.prompt_eval_count + body.eval_count;
    usage.unreportedCalls -= 1;
  }
  if (body.done_reason === 'length') throw new Error('Model output was truncated. Increase LLM_MAX_OUTPUT_TOKENS.');
  if (typeof body.message?.content !== 'string') throw new Error('Ollama did not return message content.');
  let parsed;
  try {
    parsed = JSON.parse(body.message.content);
  } catch {
    throw new Error('The model returned invalid JSON. Try a model that supports structured output.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`The model response did not match the required structure: ${issues}`);
  }
  return result.data;
}
