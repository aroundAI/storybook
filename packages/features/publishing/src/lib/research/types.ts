/**
 * Brave Search Research Types
 * Types for web and news search used to enrich social post content
 */

export interface BraveSearchOptions {
  query: string;
  count?: number;
  freshness?: 'pd' | 'pw' | 'pm' | 'py';
  country?: string;
}

export interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  source: string;
  thumbnail?: string;
}

export interface ResearchResult {
  query: string;
  webResults: BraveWebResult[];
  newsResults: BraveNewsResult[];
  searchedAt: string;
}

export interface ResearchContext {
  queries: string[];
  results: ResearchResult[];
  summary: string;
}
