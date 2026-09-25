/**
 * The agent runner's protocol (`packages/agent/src/runner.ts`), as a model
 * sees it. The runner appends the tool list and a response format to the
 * orchestrator's system prompt, then loops: the model answers with
 * `{"action":"tool_call","tool","params"}` or `{"action":"final_answer",
 * "result"}`, and each tool's (summarised) result comes back as a user turn,
 * `Tool "<name>" returned:\n<json>`.
 */

/** Both markers come from `buildSystemPromptWithTools` in the runner. */
export function isAgentRequest(systemPrompt: string) {
  return (
    systemPrompt.includes('\n# Available Tools\n') &&
    systemPrompt.includes('"action": "tool_call"')
  );
}

/** Tool names in the order the runner listed them. */
export function toolsInPrompt(systemPrompt: string) {
  return [...systemPrompt.matchAll(/^- \*\*([A-Za-z][\w-]*)\*\*: /gm)].map(
    (m) => m[1]!,
  );
}

export interface Turn {
  role: 'user' | 'model';
  text: string;
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  /** The summarised result the runner fed back, when it parsed. */
  result: Record<string, unknown> | null;
}

export interface Conversation {
  /** The orchestrator's own user prompt: the first user turn. */
  userPrompt: string;
  calls: ToolCall[];
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const RETURNED = /^Tool "([^"]+)" returned:\n([\s\S]*)$/;

/**
 * The tool calls so far: each model turn that was a tool call, paired with
 * the result turn after it.
 */
export function readConversation(turns: readonly Turn[]): Conversation {
  const userPrompt = turns.find((t) => t.role === 'user')?.text ?? '';
  const calls: ToolCall[] = [];

  turns.forEach((turn, i) => {
    if (turn.role !== 'model') return;
    const call = parseJsonObject(turn.text);
    if (call?.action !== 'tool_call' || typeof call.tool !== 'string') return;

    const next = turns[i + 1];
    const returned = next?.role === 'user' ? RETURNED.exec(next.text) : null;
    const result = returned ? parseJsonObject(returned[2] ?? '') : null;

    calls.push({
      tool: call.tool,
      params: (call.params as Record<string, unknown>) ?? {},
      result,
    });
  });

  return { userPrompt, calls };
}

/** `**Label**: value` on one line of the orchestrator's user prompt. */
export function field(userPrompt: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\*\\*${escaped}\\*\\*:\\s*(.*)$`, 'm').exec(
    userPrompt,
  );
  return match?.[1]?.trim().replace(/^"(.*)"$/, '$1');
}

/**
 * The block under a `**Label …:**` heading, up to the next line that starts
 * a bold heading.
 */
export function block(userPrompt: string, labelStart: string) {
  const lines = userPrompt.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`**${labelStart}`));
  if (start < 0) return undefined;

  const heading = lines[start]!;
  const inline = heading.replace(/^\*\*[^*]*\*\*:?\s*/, '').trim();
  const rest: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\*\*[^*]+\*\*/.test(line)) break;
    rest.push(line);
  }

  const text = [inline, ...rest].join('\n').trim();
  return text.length > 0 ? text : undefined;
}

export function integer(value: string | undefined, fallback: number) {
  const match = value?.match(/-?\d+/);
  return match ? Number(match[0]) : fallback;
}

/** "A–B" or "A-B" → [A, B]. */
export function range(value: string | undefined, fallback: [number, number]) {
  const match = value?.match(/(\d+)\s*[–-]\s*(\d+)/);
  return match
    ? ([Number(match[1]), Number(match[2])] as [number, number])
    : fallback;
}

export function toolCall(
  tool: string,
  params: Record<string, unknown>,
  reasoning: string,
) {
  return JSON.stringify(
    { action: 'tool_call', tool, params, reasoning },
    null,
    2,
  );
}

export function finalAnswer(result: unknown, reasoning: string) {
  return JSON.stringify({ action: 'final_answer', result, reasoning }, null, 2);
}
