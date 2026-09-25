import type { SocialOrigin } from './server';

/**
 * What each social endpoint may serve (FILM-1802 §3, the lead's ruling on
 * criterion 5, 2026-09-25):
 *
 * - a field the app **reads** must be documented for that endpoint in the
 *   capability reference's field index, named by its block
 *   (`docs/platform-capability-reference.md`, "Field index");
 * - an **envelope** field the app ignores (`token_type`, `paging`, a
 *   request id) must cite the vendor page that documents it.
 *
 * A response may name no key outside those two lists. The fidelity test
 * checks every entry against the index, and `undeclaredKeys` is what each
 * vendor module's tests run over what it actually served, so a template
 * cannot grow a field nobody documented.
 */
export interface EnvelopeField {
  field: string;
  /** The vendor's own documentation page for this field. */
  source: string;
}

export interface ServedEndpoint {
  origin: SocialOrigin;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The path as the vendor documents it, with `{placeholders}`. */
  path: string;
  /** The field-index block (`<platform>/<endpoint>`) the read fields come from. */
  block?: string;
  /** Fields the app reads from this response. */
  reads: readonly string[];
  envelope: readonly EnvelopeField[];
}

/**
 * Every endpoint the sandbox serves. Each vendor's PR adds its entries with
 * its handlers; an endpoint is added when an app call site is (§11).
 */
export const SERVED: readonly ServedEndpoint[] = [];

/** Vendor documentation hosts an envelope citation may point at. */
export const VENDOR_DOC_HOSTS = [
  'developers.google.com',
  'developers.tiktok.com',
  'developers.facebook.com',
  'docs.x.com',
  'developer.x.com',
  'learn.microsoft.com',
] as const;

/** What is wrong with one registry entry, given the parsed field index. */
export function registryProblems(
  endpoint: ServedEndpoint,
  index: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const where = `${endpoint.origin} ${endpoint.method} ${endpoint.path}`;
  const problems: string[] = [];

  if (endpoint.reads.length > 0) {
    const block = endpoint.block ? index.get(endpoint.block) : undefined;

    if (!endpoint.block) {
      problems.push(`${where}: reads fields but names no field-index block`);
    } else if (!block) {
      problems.push(`${where}: block "${endpoint.block}" is not in the index`);
    } else {
      for (const field of endpoint.reads) {
        if (!block.has(field)) {
          problems.push(
            `${where}: reads "${field}", which "${endpoint.block}" does not document`,
          );
        }
      }
    }
  }

  for (const { field, source } of endpoint.envelope) {
    let host = '';
    try {
      const url = new URL(source);
      host = url.protocol === 'https:' ? url.hostname : '';
    } catch {
      host = '';
    }
    if (!VENDOR_DOC_HOSTS.some((allowed) => host === allowed)) {
      problems.push(
        `${where}: envelope field "${field}" cites "${source}", not a vendor documentation page`,
      );
    }
  }

  return problems;
}

/** Every object key in a response body, at any depth. */
function keysOf(value: unknown, into = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

/** Keys a served body names that the endpoint's entry does not declare. */
export function undeclaredKeys(endpoint: ServedEndpoint, body: unknown) {
  const declared = new Set([
    ...endpoint.reads,
    ...endpoint.envelope.map((e) => e.field),
  ]);
  return [...keysOf(body)].filter((key) => !declared.has(key)).sort();
}
