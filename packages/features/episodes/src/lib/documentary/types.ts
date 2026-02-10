/**
 * Documentary Module — Shared Internal Types
 *
 * Types used by multiple files in the documentary module (fact-checker, researcher).
 * For client-facing types, see ../../types/verified-facts.ts.
 */

/** Row shape returned from the verified_facts Supabase table. */
export interface VerifiedFactRow {
    id: string;
    claim: string;
    source_citation: string;
    category: string | null;
}
