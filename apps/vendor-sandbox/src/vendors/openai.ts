import { type Handler, sendJson } from '../http';
import { summarise } from '../ledger';
import type { SandboxState } from '../state';

/**
 * OpenAI, for the one call the app still makes: the settings page's key
 * check, `GET /v1/models`. Nothing else in the app reaches OpenAI (FILM-1803
 * §3), so anything else gets the vendor's "invalid URL" error rather than an
 * answer that would certify a call nobody makes.
 */

export const VENDOR = 'openai';

export const INVALID_KEY = 'sandbox-invalid-key';

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'whisper-1', 'text-embedding-3-small'];

export function openAiHandler(state: SandboxState): Handler {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.localhost');
    const method = req.method ?? 'GET';
    const auth = req.headers.authorization ?? '';
    const key = auth.replace(/^Bearer\s+/i, '');
    const started = Date.now();

    const json = (status: number, value: unknown, injectedFailure = false) => {
      const sent = sendJson(res, status, value);
      state.ledger.record({
        vendor: VENDOR,
        method,
        path: url.pathname,
        keyPresent: Boolean(key),
        status,
        durationMs: Date.now() - started,
        responseSummary: summarise(sent),
        injectedFailure,
      });
    };

    if (!key || key === INVALID_KEY) {
      return json(401, {
        error: {
          message:
            'Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key',
        },
      });
    }

    const injected = state.takeFailure(VENDOR, url.pathname);
    if (injected) {
      return json(
        injected.status,
        {
          error: {
            message: 'The server had an error while processing your request.',
            type: 'server_error',
            param: null,
            code: null,
          },
        },
        true,
      );
    }

    if (method === 'GET' && url.pathname === '/v1/models') {
      return json(200, {
        object: 'list',
        data: MODELS.map((id, i) => ({
          id,
          object: 'model',
          created: 1_715_367_049 + i * 86_400,
          owned_by: 'system',
        })),
      });
    }

    return json(404, {
      error: {
        message: `Invalid URL (${method} ${url.pathname})`,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    });
  };
}
