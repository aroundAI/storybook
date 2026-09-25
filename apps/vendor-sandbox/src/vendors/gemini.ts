import type http from 'node:http';

import { type Handler, parseJson, sendJson } from '../http';
import { type LedgerEntry, summarise } from '../ledger';
import {
  finalAnswer,
  isAgentRequest,
  readConversation,
  toolCall,
  toolsInPrompt,
} from '../llm/agents/protocol';
import { nextMove, scriptFor } from '../llm/agents/scripts';
import {
  UNRECOGNISED_RESPONSE,
  identify,
  respondToPrompt,
} from '../llm/respond';
import type { SandboxState } from '../state';

/**
 * The Gemini API as `@google/genai` calls it: `generateContent`,
 * `streamGenerateContent` (SSE), and the models list the settings page
 * uses to validate a key. Developer API (`/v1beta/models/…`) and Vertex
 * Express (`/v1beta1/publishers/google/models/…`) paths are both served.
 *
 * Every prompt the app has is answered with output of that prompt's own
 * shape (see `llm/respond.ts`). Anything else is answered, flagged in the
 * ledger and logged loudly.
 */

export const VENDOR = 'gemini';

/** The key a test sends to see the vendor's rejection. */
export const INVALID_KEY = 'sandbox-invalid-key';

const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

interface Part {
  text?: string;
}
interface Content {
  role?: string;
  parts?: Part[];
}
interface GenerateRequest {
  contents?: Content[];
  systemInstruction?: Content | string;
  system_instruction?: Content | string;
}

const STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  503: 'UNAVAILABLE',
};

const MESSAGES: Record<number, string> = {
  429: 'Resource has been exhausted (e.g. check quota).',
  500: 'An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting',
  503: 'The model is overloaded. Please try again later.',
};

function errorBody(status: number, message?: string) {
  return {
    error: {
      code: status,
      message: message ?? MESSAGES[status] ?? 'Request failed.',
      status: STATUS_NAMES[status] ?? 'UNKNOWN',
    },
  };
}

function textOf(content: Content | string | undefined) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return (content.parts ?? []).map((p) => p.text ?? '').join('');
}

function apiKeyOf(req: http.IncomingMessage, url: URL) {
  const header = req.headers['x-goog-api-key'];
  return (
    (Array.isArray(header) ? header[0] : header) ??
    url.searchParams.get('key') ??
    ''
  );
}

const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(text.length / 4));

export function geminiHandler(state: SandboxState): Handler {
  return (req, res, body) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const key = apiKeyOf(req, url);
    const started = Date.now();

    const record = (entry: Parameters<SandboxState['ledger']['record']>[0]) =>
      state.ledger.record({ ...entry, durationMs: Date.now() - started });

    const fail = (status: number, message?: string, injected = false) => {
      const sent = sendJson(res, status, errorBody(status, message));
      record({
        vendor: VENDOR,
        method,
        path,
        keyPresent: Boolean(key),
        status,
        responseSummary: sent,
        injectedFailure: injected,
      });
    };

    if (!key)
      return fail(
        403,
        "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
      );
    if (key === INVALID_KEY)
      return fail(400, 'API key not valid. Please pass a valid API key.');

    const injected = state.takeFailure(VENDOR, path);
    if (injected) return fail(injected.status, undefined, true);

    if (method === 'GET' && /\/models\/?$/.test(path)) {
      const sent = sendJson(res, 200, {
        models: MODELS.map((name) => ({
          name: `models/${name}`,
          displayName: name,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        })),
      });
      record({
        vendor: VENDOR,
        method,
        path,
        keyPresent: true,
        status: 200,
        responseSummary: summarise(sent),
      });
      return;
    }

    const call =
      /\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(path);
    if (method !== 'POST' || !call)
      return fail(404, `Method not found: ${method} ${path}`);

    const model = call[1] ?? 'gemini';
    const stream = call[2] === 'streamGenerateContent';
    const request = parseJson(body) as GenerateRequest | undefined;
    if (!request?.contents?.length)
      return fail(
        400,
        '* GenerateContentRequest.contents: contents is not specified',
      );

    const systemPrompt = textOf(
      request.systemInstruction ?? request.system_instruction,
    );
    const userPrompt = request.contents
      .filter((c) => c.role !== 'model')
      .map((c) => textOf(c))
      .join('\n\n');

    const agent = isAgentRequest(systemPrompt)
      ? scriptFor(systemPrompt)
      : undefined;
    const identified = agent
      ? undefined
      : identify(systemPrompt, state.catalog);
    let ledgerIdentity: LedgerEntry['identified'];
    let reply: string;
    let unplaced: string[] = [];

    if (agent) {
      const turns = request.contents.map((c) => ({
        role: c.role === 'model' ? ('model' as const) : ('user' as const),
        text: textOf(c),
      }));
      const conversation = readConversation(turns);
      const latest = conversation.calls.at(-1);
      if (latest?.result?.success === false) {
        const failure = {
          orchestrator: agent.name,
          tool: latest.tool,
          error: String(latest.result.error ?? 'unknown error'),
        };
        state.agentToolFailures.push(failure);
        console.warn(
          `[sandbox] ${failure.orchestrator}: tool ${failure.tool} failed: ${failure.error}`,
        );
      }
      const move = nextMove(agent, {
        conversation,
        tools: toolsInPrompt(systemPrompt),
        rng: state.nextRng(),
      });
      reply =
        move.kind === 'tool_call'
          ? toolCall(
              move.tool,
              move.params,
              `Following the ${agent.name} steps: ${move.tool} next.`,
            )
          : finalAnswer(
              move.result,
              'Every step has run; the quality checks passed.',
            );
      ledgerIdentity = { kind: 'agent', key: agent.name, step: move.step };
    } else if (identified?.kind === 'prompt') {
      const injected = state.takeFailure(VENDOR, path, identified.key);
      if (injected) return fail(injected.status, undefined, true);
      ledgerIdentity = { kind: 'prompt', key: identified.key };
      const prompt = state.catalog.find((p) => p.key === identified.key)!;
      const response = respondToPrompt(
        prompt,
        userPrompt,
        state.nextRng(),
        state.quality,
      );
      reply = response.text;
      unplaced = response.unplaced;
      for (const field of unplaced) {
        if (!state.unplaced.has(`${identified.key}:${field}`)) {
          state.unplaced.add(`${identified.key}:${field}`);
          console.warn(
            `[sandbox] no corpus rule for ${identified.key} field "${field}"; it got a generic sentence`,
          );
        }
      }
    } else {
      ledgerIdentity = { kind: 'unrecognised' };
      reply = UNRECOGNISED_RESPONSE;
      state.unrecognised.push({
        vendor: VENDOR,
        at: new Date().toISOString(),
        systemPromptStart: systemPrompt.slice(0, 200),
      });
      console.warn(
        `[sandbox] UNRECOGNISED PROMPT (gemini ${model}); answered ${UNRECOGNISED_RESPONSE}. System prompt starts: ${JSON.stringify(systemPrompt.slice(0, 120))}`,
      );
    }

    const promptTokens = estimateTokens(systemPrompt + userPrompt);
    const replyTokens = estimateTokens(reply);
    const usageMetadata = {
      promptTokenCount: promptTokens,
      candidatesTokenCount: replyTokens,
      totalTokenCount: promptTokens + replyTokens,
    };
    const responseId = `sbx-${state.ledger.size + 1}`;
    const envelope = (text: string, last: boolean) => ({
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          ...(last ? { finishReason: 'STOP' } : {}),
          index: 0,
        },
      ],
      ...(last ? { usageMetadata } : {}),
      modelVersion: model,
      responseId,
    });

    let bytes: number;
    if (stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      const size = Math.max(1, Math.ceil(reply.length / 3));
      const chunks = [
        reply.slice(0, size),
        reply.slice(size, size * 2),
        reply.slice(size * 2),
      ];
      let written = '';
      chunks.forEach((chunk, i) => {
        const line = `data: ${JSON.stringify(envelope(chunk, i === chunks.length - 1))}\r\n\r\n`;
        written += line;
        res.write(line);
      });
      res.end();
      bytes = Buffer.byteLength(written);
    } else {
      bytes = Buffer.byteLength(sendJson(res, 200, envelope(reply, true)));
    }

    record({
      vendor: VENDOR,
      method,
      path,
      keyPresent: true,
      status: 200,
      identified: ledgerIdentity,
      requestSummary: summarise(userPrompt),
      responseSummary: summarise(reply),
      bytes,
      ...(unplaced.length > 0 ? { unplacedFields: unplaced } : {}),
    });
  };
}
