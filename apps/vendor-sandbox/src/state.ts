import { Ledger } from './ledger';
import type { Quality } from './llm/generate/context';
import { type CatalogPrompt, loadCatalog } from './llm/prompts';
import { requestRng } from './rng';

/** Make the next `count` calls to a vendor (optionally one path) fail. */
export interface FailureRule {
  vendor: string;
  pathIncludes?: string;
  status: number;
  count: number;
}

export interface UnrecognisedRequest {
  vendor: string;
  at: string;
  systemPromptStart: string;
}

/** One run: its seed, what it served, and what it was told to break. */
export class SandboxState {
  readonly ledger = new Ledger();
  readonly catalog: CatalogPrompt[];
  readonly unplaced = new Set<string>();
  readonly unrecognised: UnrecognisedRequest[] = [];
  failures: FailureRule[] = [];
  seed: number;
  quality: Quality;
  private requestIndex = 0;

  constructor(options: {
    seed: number;
    quality?: Quality;
    catalog?: CatalogPrompt[];
  }) {
    this.seed = options.seed;
    this.quality = options.quality ?? 'high';
    this.catalog = options.catalog ?? loadCatalog();
  }

  /** A fresh random stream for the next request, replayable from the seed. */
  nextRng() {
    return requestRng(this.seed, this.requestIndex++);
  }

  reset(seed: number) {
    this.seed = seed;
    this.requestIndex = 0;
    this.ledger.clear();
    this.unplaced.clear();
    this.unrecognised.length = 0;
    this.failures = [];
  }

  /** The failure injected for this call, if any, consuming one use of it. */
  takeFailure(vendor: string, path: string) {
    const rule = this.failures.find(
      (f) =>
        f.vendor === vendor &&
        f.count > 0 &&
        (!f.pathIncludes || path.includes(f.pathIncludes)),
    );
    if (!rule) return undefined;
    rule.count -= 1;
    this.failures = this.failures.filter((f) => f.count > 0);
    return rule;
  }
}
