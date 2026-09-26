/**
 * Every request the app made and what was served, newest first (FILM-1802
 * §6). Tests assert "the page shows what the ledger says was served", which
 * is how random data and exact assertions coexist. Kept in memory, capped,
 * and cleared by a reset.
 */
export interface LedgerEntry {
  id: number;
  at: string;
  vendor: string;
  method: string;
  path: string;
  /** Whether a key was sent. The key itself is never recorded. */
  keyPresent: boolean;
  identified?: {
    kind: 'prompt' | 'agent' | 'unrecognised';
    key?: string;
    step?: number;
  };
  status: number;
  requestSummary?: string;
  responseSummary?: string;
  bytes?: number;
  durationMs?: number;
  injectedFailure?: boolean;
  unplacedFields?: string[];
  error?: string;
}

export const LEDGER_CAP = 5_000;
const SUMMARY_CAP = 2_000;

export function summarise(text: string) {
  return text.length > SUMMARY_CAP ? `${text.slice(0, SUMMARY_CAP)}…` : text;
}

export class Ledger {
  private entries: LedgerEntry[] = [];
  private nextId = 1;
  private evicted = false;

  record(entry: Omit<LedgerEntry, 'id' | 'at'>): LedgerEntry {
    const full = { id: this.nextId++, at: new Date().toISOString(), ...entry };
    this.entries.push(full);
    if (this.entries.length > LEDGER_CAP) {
      this.entries.shift();
      if (!this.evicted) {
        this.evicted = true;
        console.warn(
          `[sandbox] ledger reached ${LEDGER_CAP} rows; the oldest are now dropped`,
        );
      }
    }
    return full;
  }

  /** Newest first, optionally one vendor's and after an id. */
  list(filter: { vendor?: string; sinceId?: number } = {}) {
    return this.entries
      .filter((e) => !filter.vendor || e.vendor === filter.vendor)
      .filter((e) => filter.sinceId === undefined || e.id > filter.sinceId)
      .reverse();
  }

  clear() {
    this.entries = [];
    this.evicted = false;
  }

  get size() {
    return this.entries.length;
  }
}
