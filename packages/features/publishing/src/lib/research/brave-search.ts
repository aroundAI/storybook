import type {
  BraveNewsResult,
  BraveSearchOptions,
  BraveWebResult,
  ResearchContext,
  ResearchResult,
} from './types';

const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1';

/**
 * Brave Search client for enriching social post content
 * with relevant news and web results
 */
export class BraveSearchClient {
  constructor(private apiKey: string) {}

  /**
   * Search the web for relevant content
   */
  async searchWeb(options: BraveSearchOptions): Promise<BraveWebResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      count: String(options.count ?? 5),
      ...(options.freshness && { freshness: options.freshness }),
      ...(options.country && { country: options.country }),
    });

    const response = await fetch(
      `${BRAVE_API_BASE}/web/search?${params.toString()}`,
      {
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Brave web search failed: ${error}`);
    }

    const data = await response.json();
    const results = data.web?.results ?? [];

    return results.map(
      (r: {
        title: string;
        url: string;
        description: string;
        age?: string;
      }) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        age: r.age,
      }),
    );
  }

  /**
   * Search news for recent/trending content
   */
  async searchNews(options: BraveSearchOptions): Promise<BraveNewsResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      count: String(options.count ?? 5),
      ...(options.freshness && { freshness: options.freshness }),
      ...(options.country && { country: options.country }),
    });

    const response = await fetch(
      `${BRAVE_API_BASE}/news/search?${params.toString()}`,
      {
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Brave news search failed: ${error}`);
    }

    const data = await response.json();
    const results = data.results ?? [];

    return results.map(
      (r: {
        title: string;
        url: string;
        description: string;
        age?: string;
        meta_url?: { hostname: string };
        thumbnail?: { src: string };
      }) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        age: r.age,
        source: r.meta_url?.hostname ?? '',
        thumbnail: r.thumbnail?.src,
      }),
    );
  }

  /**
   * Perform comprehensive research for a topic
   * Runs both web and news searches with intelligent query generation
   */
  async research(rawNotes: string): Promise<ResearchContext> {
    const queries = this.extractSearchQueries(rawNotes);

    const resultsPromises = queries.slice(0, 3).map(async (query) => {
      try {
        const [webResults, newsResults] = await Promise.all([
          this.searchWeb({ query, count: 5, freshness: 'pw' }),
          this.searchNews({ query, count: 5, freshness: 'pw' }),
        ]);

        return {
          query,
          webResults,
          newsResults,
          searchedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error(`Research query failed for "${query}":`, error);
        return null;
      }
    });

    const resolvedResults = await Promise.all(resultsPromises);
    const results = resolvedResults.filter(
      (r): r is ResearchResult => r !== null,
    );

    const summary = this.buildResearchSummary(results);

    return {
      queries,
      results,
      summary,
    };
  }

  /**
   * Extract search queries from raw notes
   * Uses simple NLP heuristics to identify key topics
   */
  private extractSearchQueries(notes: string): string[] {
    const sentences = notes
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10 && s.length < 200);

    if (sentences.length === 0) {
      return [notes.substring(0, 100).trim()];
    }

    const queries: string[] = [];

    if (sentences[0]) {
      queries.push(sentences[0]);
    }

    // Look for sentences with numbers/statistics (likely factual claims to verify)
    const factualSentences = sentences.filter((s) => /\d+/.test(s));
    if (factualSentences[0] && !queries.includes(factualSentences[0])) {
      queries.push(factualSentences[0]);
    }

    // Look for sentences with proper nouns (names, companies, technologies)
    const properNounSentences = sentences.filter((s) =>
      /[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/.test(s),
    );
    for (const s of properNounSentences) {
      if (queries.length >= 3) break;
      if (!queries.includes(s)) {
        queries.push(s);
      }
    }

    return queries.slice(0, 3);
  }

  /**
   * Build a human-readable summary of research findings
   * This gets injected into the AI prompt as context
   */
  private buildResearchSummary(results: ResearchResult[]): string {
    if (results.length === 0) {
      return 'No research results found.';
    }

    const sections: string[] = [];

    for (const result of results) {
      const newsItems = result.newsResults
        .slice(0, 3)
        .map(
          (n) =>
            `- ${n.title} (${n.source}${n.age ? `, ${n.age}` : ''}): ${n.description}`,
        )
        .join('\n');

      const webItems = result.webResults
        .slice(0, 3)
        .map((w) => `- ${w.title}: ${w.description}`)
        .join('\n');

      sections.push(
        `### Research for: "${result.query}"\n` +
          (newsItems ? `\n**Recent News:**\n${newsItems}\n` : '') +
          (webItems ? `\n**Web Results:**\n${webItems}` : ''),
      );
    }

    return sections.join('\n\n');
  }

  private getHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': this.apiKey,
    };
  }
}

/**
 * Creates a Brave Search client instance
 */
export function createBraveSearchClient(apiKey?: string): BraveSearchClient {
  const key = apiKey ?? process.env.BRAVE_SEARCH_API_KEY;

  if (!key) {
    throw new Error(
      'Brave Search API key not configured. Set BRAVE_SEARCH_API_KEY environment variable.',
    );
  }

  return new BraveSearchClient(key);
}
