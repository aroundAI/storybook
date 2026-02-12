# FILM-1141: Fact Source Upload & Extraction

| Field | Value |
|-------|-------|
| **Status** | ✅ DONE |
| **Priority** | P1 |
| **Estimate** | 10h |
| **Dependencies** | FILM-1135, FILM-1140 |

## Summary

Enable users to upload documents (PDF, DOCX, TXT) and add URLs, then automatically extract factual statements using LLM.

## Goals

1. Multi-format file upload with parsing
2. URL content fetching and parsing
3. LLM-based fact extraction
4. Entity extraction (people, places, dates, organizations)
5. Store extracted facts in `external_content` table

---

## Component: AddSourceDialog

### Trigger

"+ Add Source" button in Research Hub

### Tabs

```
┌──────────────────────────────────────────────────────────────────┐
│  Add Source                                                   ✕  │
│                                                                  │
│  [📄 File] [🔗 URL] [📡 API]                                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │         📄 Drop files here or click to browse              │ │
│  │                                                            │ │
│  │         Supported: PDF, DOCX, TXT, MD                      │ │
│  │         Max size: 10MB                                     │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Source Name: [Auto-filled from filename____________]           │
│                                                                  │
│  Credibility Tier:                                              │
│  ○ Tier 1 - Primary (academic, government, official)           │
│  ● Tier 2 - Secondary (news, Wikipedia, mainstream)            │
│  ○ Tier 3 - Tertiary (blogs, social, user-generated)           │
│                                                                  │
│  [Cancel]                                     [Upload & Extract] │
└──────────────────────────────────────────────────────────────────┘
```

### URL Tab

```
┌──────────────────────────────────────────────────────────────────┐
│  URL: [https://en.wikipedia.org/wiki/Mars_________]             │
│                                                                  │
│  [Fetch Preview]                                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Mars - Wikipedia                                          │ │
│  │  Mars is the fourth planet from the Sun...                 │ │
│  │  Word count: 15,432                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ☐ Auto-refresh weekly                                          │
│                                                                  │
│  [Cancel]                                     [Add & Extract]    │
└──────────────────────────────────────────────────────────────────┘
```

### API Tab

```
┌──────────────────────────────────────────────────────────────────┐
│  Provider: [NewsAPI ▼]                                          │
│                                                                  │
│  Category: [Science ▼]                                          │
│                                                                  │
│  Keywords: [Mars mission, space exploration____]                │
│                                                                  │
│  Balance Sources:                                               │
│  ☑️ Include left-leaning sources                                │
│  ☑️ Include center sources                                      │
│  ☑️ Include right-leaning sources                               │
│                                                                  │
│  Refresh: [Every 24 hours ▼]                                    │
│                                                                  │
│  [Cancel]                                     [Connect API]      │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Parsing Pipeline

### Supported Formats

| Format | Parser | Notes |
|--------|--------|-------|
| PDF | `pdf-parse` | Text extraction, OCR fallback |
| DOCX | `mammoth` | Preserves structure |
| TXT/MD | Native | Direct text |

### Processing Flow

```
Upload → Parse → Chunk → Extract Facts → Store
```

1. **Upload**: Store file in Supabase Storage
2. **Parse**: Extract text using appropriate parser
3. **Chunk**: Split into ~2000 token chunks with overlap
4. **Extract**: LLM extracts facts from each chunk
5. **Store**: Save to `external_content` table

---

## Fact Extraction Prompt

```json
{
  "name": "fact-extraction",
  "template": "prompts/research/fact-extraction.json",
  "model": {
    "provider": "openai",
    "model": "gpt-4o-mini"
  },
  "schema": {
    "facts": [{
      "statement": "string",
      "confidence": "number (0-1)",
      "entities": {
        "people": ["string"],
        "places": ["string"],
        "dates": ["string"],
        "organizations": ["string"]
      },
      "category": "historical | scientific | biographical | statistical"
    }]
  }
}
```

### Example Extraction

**Input chunk:**
> "Water was discovered on Mars by NASA's Perseverance rover in 2024. The discovery was announced at a press conference in Washington D.C."

**Extracted:**
```json
{
  "facts": [{
    "statement": "Water was discovered on Mars by NASA's Perseverance rover in 2024",
    "confidence": 0.95,
    "entities": {
      "places": ["Mars", "Washington D.C."],
      "dates": ["2024"],
      "organizations": ["NASA"]
    },
    "category": "scientific"
  }]
}
```

---

## Server Actions

```typescript
// packages/features/episodes/src/server/source-upload-actions.ts

export async function uploadFileSourceAction(
  projectId: string,
  file: File,
  options: {
    name: string;
    tier: 1 | 2 | 3;
  }
): Promise<{ sourceId: string; jobId: string }>;

export async function addUrlSourceAction(
  projectId: string,
  url: string,
  options: {
    name: string;
    tier: 1 | 2 | 3;
    refreshInterval?: number;
  }
): Promise<{ sourceId: string; jobId: string }>;

export async function connectApiSourceAction(
  projectId: string,
  config: {
    provider: 'newsapi' | 'semantic_scholar' | 'wikipedia';
    categories?: string[];
    query?: string;
    balanceBias?: boolean;
    refreshInterval: number;
  }
): Promise<{ sourceId: string }>;

export async function extractFactsAction(
  sourceId: string
): Promise<{ jobId: string }>;

export async function getExtractionStatusAction(
  jobId: string
): Promise<{ status: string; progress: number; facts?: Fact[] }>;
```

---

## Background Job: fact-extraction

Uses existing Lambda job queue infrastructure.

```typescript
// Job payload
interface FactExtractionJob {
  type: 'fact-extraction';
  sourceId: string;
  projectId: string;
  chunks: string[];
}
```

---

## Acceptance Criteria

- [x] File upload works for PDF, DOCX, TXT, MD
- [x] URL fetch extracts text content
- [x] API sources can be configured with categories
- [x] LLM extracts facts with entities
- [x] Progress shown during extraction
- [x] Extracted facts appear in Facts list
- [x] Source credibility tier is stored
- [x] Error handling for failed uploads/extractions
