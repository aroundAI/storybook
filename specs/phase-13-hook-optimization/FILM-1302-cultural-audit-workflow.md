---
spec_id: FILM-1302
title: Cultural Audit Workflow ("The Nuance Gate")
status: Draft
effort: M
dependencies: FILM-1301
---

# Cultural Audit Workflow ("The Nuance Gate")

## 1. Overview

To successfully traverse the multi-language matrix (EN, HI, BN, ES, PT), content cannot simply be translated; it must be **culturally adapted**. The Cultural Audit Workflow introduces a human-in-the-loop (or specialized AI agent) gate before publishing to non-primary languages. This prevents cultural faux pas, mistranslations, and inappropriate tone from reaching audiences.

> [!IMPORTANT]
> This spec maps every proposed component to concrete codebase integration points, so AI agents can implement the Cultural Audit incrementally with full context.

---

## 2. Workflow

### 2.1 Trigger

An audit is triggered automatically when:
- An episode is marked `Ready for Review` (status = `ready`) AND has `Target Languages > 1`
- A new localized dub/translation is generated for a non-primary language
- Manual trigger from the Publishing Hub before publishing localized content

**Logic:**
```typescript
if (episode.localizedVideos && Object.keys(episode.localizedVideos).length > 0) {
  const nonPrimaryLanguages = Object.keys(episode.localizedVideos)
    .filter(lang => lang !== project.primaryLanguage);
  // Create audit for each non-primary language
  for (const lang of nonPrimaryLanguages) {
    await createCulturalAuditAction({ episodeId, languageCode: lang });
  }
}
```

### 2.2 The Audit Interface

**Route:** `/home/[account]/studio/[projectSlug]/episodes/[episodeId]/audit`

A side-by-side comparison view for the auditor:

| Left Panel | Right Panel |
|------------|-------------|
| Original Script/Video (primary language) | Localized Script/Video (target language) |
| Original dialogue lines | Translated dialogue lines |
| Original tone indicators | Localized tone indicators |

**Checklist items (auto-generated per language pair):**
1. **Idiom Check**: "Is 'Hit the road' translated literally or adapted?"
2. **Tone Check**: "Is the character too formal/informal for this culture?"
3. **Visual Check**: "Does text overlay match the local script?"
4. **Cultural Reference Check**: "Are references understandable in the target culture?"
5. **Name/Pronoun Check**: "Are names and pronouns culturally appropriate?"

### 2.3 Auditor Actions

| Action | Effect |
|--------|--------|
| **Approve** | Moves to `Ready to Publish` for this language |
| **Request Changes** | Highlights timestamp/line, adds "Cultural Note", auto-generates re-translation task |
| **Flag for Expert** | Escalates to a native speaker or cultural consultant |
| **Partial Approve** | Approves some sections, flags others |

---

## 3. Data Architecture

### 3.1 Database Schema (Supabase)

```sql
-- Audit status enum
CREATE TYPE audit_status AS ENUM ('pending', 'in_review', 'approved', 'changes_requested', 'rejected');
CREATE TYPE audit_item_type AS ENUM ('idiom', 'tone', 'visual', 'cultural_reference', 'name_pronoun', 'custom');

-- Cultural audit records
CREATE TABLE cultural_audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  language_code TEXT NOT NULL,               -- 'es', 'pt', 'hi', 'bn', etc.
  auditor_id UUID REFERENCES auth.users(id), -- Human auditor (NULL = unassigned)
  agent_id TEXT,                              -- AI agent persona ID (for AI auditing)
  status audit_status DEFAULT 'pending',
  overall_score NUMERIC,                     -- 0-100 cultural confidence score
  summary TEXT,                              -- Overall assessment summary
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(episode_id, language_code)          -- One audit per episode-language pair
);

-- Individual audit checklist items / feedback notes
CREATE TABLE cultural_audit_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES cultural_audits(id) ON DELETE CASCADE,
  item_type audit_item_type NOT NULL,
  timestamp_start TEXT,                      -- "00:12" format (links to video position)
  timestamp_end TEXT,
  original_text TEXT,                        -- Original dialogue/text
  localized_text TEXT,                       -- Current translation
  suggested_fix TEXT,                        -- Auditor's suggested correction
  note TEXT NOT NULL,                        -- Explanation (e.g., "Wrong slang for Mexican Spanish")
  severity TEXT CHECK (severity IN ('critical', 'major', 'minor', 'suggestion')),
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE cultural_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cultural_audit_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY cultural_audits_select ON cultural_audits FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE id = auth.uid()
    UNION SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()));

CREATE POLICY cultural_audits_insert ON cultural_audits FOR INSERT
  WITH CHECK (account_id IN (SELECT id FROM accounts WHERE id = auth.uid()
    UNION SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()));
```

### 3.2 Relationship to Episode Status

The Cultural Audit acts as a **gate** between `ready` and `published` for localized content:

```
ready → [Cultural Audit: pending] → [Cultural Audit: approved] → published (per language)
                                  → [Cultural Audit: changes_requested] → re-translate → re-audit
```

The audit does NOT block the primary language from publishing — only non-primary languages.

---

## 4. Implementation Map

### 4.1 Option A: Extend `@kit/episodes` (Recommended)

Since audits are tightly coupled to episodes and their localized content, keep within the episodes package.

**New files within `packages/features/episodes/`:**
```
packages/features/episodes/
├── src/
│   ├── components/
│   │   ├── cultural-audit/
│   │   │   ├── audit-dashboard.tsx         # List of audits for an episode
│   │   │   ├── audit-sidebar.tsx           # Side-by-side comparison view
│   │   │   ├── audit-checklist.tsx         # Checklist items with approve/reject
│   │   │   ├── audit-note-form.tsx         # Add cultural note with timestamp
│   │   │   ├── audit-status-badge.tsx      # Status indicator badges
│   │   │   └── language-audit-card.tsx     # Per-language audit summary card
│   ├── server/
│   │   ├── cultural-audit-actions.ts       # CRUD for audits + items
│   │   ├── ai-audit-actions.ts            # AI agent pre-pass
│   │   └── audit-publish-gate.ts          # Block publishing if audit not approved
│   ├── lib/
│   │   ├── audit-types.ts                 # CulturalAudit, AuditItem, AuditStatus types
│   │   └── audit-constants.ts             # Severity levels, item types, language pairs
```

### 4.2 Integration Points with Existing Code

| Integration | Existing Code | How Audit Connects |
|-------------|---------------|-------------------|
| **Episode lifecycle** | `status-workflow.ts` — episode status transitions | Add audit gate check in `ready → published` transition |
| **Localized videos** | `Episode.localizedVideos` field in types | Audit references the localized video URL for the target language |
| **Dialogue lines** | `dialogue_lines` table + `ScreenplayDialogueLine` type | Side-by-side view shows original vs translated dialogue |
| **Publishing gate** | `publishToAllAction` in `@kit/publishing` | Check `cultural_audits.status = 'approved'` before allowing non-primary language publish |
| **Translated dialogue** | `translate-dialogue` generation job type | Re-translation triggered when audit requests changes |
| **TTS/dubbing** | `@kit/audio-generation` — voice generation | Cultural notes on tone may require TTS re-generation |
| **Publishing Hub UI** | Episode publish screen components | Show audit status badges per language; block publish button if `pending`/`changes_requested` |
| **Permissions** | `canPerformProjectAction()` in `@kit/projects/queries` | Guard audit actions; new permission: `project.audit` |
| **Prompt engine** | `@kit/prompt-engine` | New prompt: `cultural-audit/ai-pre-audit.json` for AI auditor pass |
| **Notifications** | `@kit/notifications` | Notify auditor when assigned; notify creator when audit complete |

### 4.3 New Prompt Template

**File:** `packages/features/prompt-engine/src/prompts/cultural-audit/ai-pre-audit.json`

**Purpose:** AI agent performs a pre-pass on translated content, flagging potential cultural issues before a human auditor reviews.

**Template variables:**
- `{{original_script}}` — Primary language script/dialogue
- `{{translated_script}}` — Target language translation
- `{{source_language}}` — e.g., "English"
- `{{target_language}}` — e.g., "Mexican Spanish"
- `{{cultural_persona}}` — e.g., "A Mexican cultural consultant with expertise in media localization"
- `{{character_descriptions}}` — Character context for tone matching

**Expected output schema:**
```typescript
z.object({
  overallScore: z.number().min(0).max(100),
  summary: z.string(),
  issues: z.array(z.object({
    type: z.enum(['idiom', 'tone', 'visual', 'cultural_reference', 'name_pronoun']),
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    originalText: z.string(),
    localizedText: z.string(),
    issue: z.string(),
    suggestedFix: z.string(),
    lineNumber: z.number().optional(),
  }))
})
```

### 4.4 App Routes

**New route files:**
```
apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeId]/audit/
├── page.tsx                    # Audit dashboard for this episode
├── [auditId]/
│   └── page.tsx                # Individual audit review (side-by-side)
└── loading.tsx
```

### 4.5 Publishing Gate Integration

**File to modify:** `packages/features/publishing/src/server/publish-actions.ts`

Add audit gate check before non-primary language publishing:

```typescript
// Inside publishToAllAction, before uploading
if (publishLanguage !== project.primaryLanguage) {
  const { data: audit } = await client
    .from('cultural_audits')
    .select('status')
    .eq('episode_id', episodeId)
    .eq('language_code', publishLanguage)
    .single();

  if (audit && audit.status !== 'approved') {
    throw new Error(
      `Cultural audit not approved for ${publishLanguage}. ` +
      `Current status: ${audit.status}`
    );
  }
}
```

---

## 5. AI Agent Auditors

### 5.1 Concept

Instead of (or before) a human `auditor_id`, an AI agent can perform a pre-pass. The agent is configured with a cultural persona (e.g., "Mexican Cultural Consultant") that reviews the script and pre-populates `cultural_audit_items` before a human sees them.

### 5.2 Implementation

```typescript
// server/ai-audit-actions.ts
import { loadPrompt, executePrompt } from '@kit/prompt-engine';

export const runAiPreAuditAction = enhanceAction(
  async (data) => {
    // 1. Load the cultural audit prompt
    const prompt = await loadPrompt('cultural-audit/ai-pre-audit');

    // 2. Fetch original + translated scripts
    const episode = await getEpisode(data.episodeId);
    const originalScript = episode.screenplayData?.scenes
      .map(s => s.dialogue.map(d => `${d.character}: ${d.text}`).join('\n'))
      .join('\n\n');

    // Fetch translated dialogue
    const { data: translatedLines } = await client
      .from('dialogue_lines')
      .select('*')
      .eq('episode_id', data.episodeId)
      .order('sequence_number');
    
    // 3. Execute AI audit
    const result = await executePrompt(prompt, {
      original_script: originalScript,
      translated_script: translatedLines.map(l => l.translated_text).join('\n'),
      source_language: data.sourceLanguage,
      target_language: data.targetLanguage,
      cultural_persona: data.culturalPersona,
      character_descriptions: data.characterContext,
    });

    // 4. Insert flagged issues as audit items
    const items = result.issues.map(issue => ({
      audit_id: data.auditId,
      item_type: issue.type,
      original_text: issue.originalText,
      localized_text: issue.localizedText,
      suggested_fix: issue.suggestedFix,
      note: issue.issue,
      severity: issue.severity,
    }));

    await client.from('cultural_audit_items').insert(items);

    // 5. Update audit with overall score
    await client
      .from('cultural_audits')
      .update({
        overall_score: result.overallScore,
        summary: result.summary,
        agent_id: data.culturalPersona,
        status: 'in_review', // Ready for human review
      })
      .eq('id', data.auditId);

    return { itemCount: items.length, score: result.overallScore };
  },
  { schema: AiPreAuditSchema }
);
```

---

## 6. UI Extensions

### 6.1 Episode List Indicators

**File to modify:** Episode list components in `packages/features/episodes/src/components/`

Add audit status columns/badges:
- 🟡 `Audit Pending` — Audit created but not reviewed
- 🔵 `In Review` — Auditor assigned, review in progress
- 🟢 `Approved` — Ready to publish for this language
- 🔴 `Changes Requested` — Issues flagged, needs re-translation
- ⚪ `N/A` — Primary language, no audit needed

### 6.2 Publishing Hub Gate

**File to modify:** Publish screen components in `packages/features/publishing/src/components/`

- Show per-language audit status next to each platform connection
- Disable publish button for connections whose language hasn't passed audit
- Show "Run AI Pre-Audit" button for unaudited languages

---

## 7. Security & Risk

- **Permission model**: New permission scope `project.audit` for auditor assignment. Creators can view but not approve their own content.
- **Multi-tenancy**: All audit data scoped by `account_id` with RLS policies.
- **AI hallucination risk**: AI pre-audit results are suggestions only — always requires human confirmation before `approved` status.
- **Cost control**: AI pre-audit costs are per-episode per-language. Display estimated cost before running.

---

## 8. Quick Reference: Proposed File Paths

| Concern | Proposed Path |
|---------|---------------|
| Audit components | `packages/features/episodes/src/components/cultural-audit/` |
| Audit CRUD actions | `packages/features/episodes/src/server/cultural-audit-actions.ts` |
| AI pre-audit actions | `packages/features/episodes/src/server/ai-audit-actions.ts` |
| Publish gate logic | `packages/features/episodes/src/server/audit-publish-gate.ts` |
| Audit types | `packages/features/episodes/src/lib/audit-types.ts` |
| Constants | `packages/features/episodes/src/lib/audit-constants.ts` |
| AI prompt template | `prompt-engine/src/prompts/cultural-audit/ai-pre-audit.json` |
| Audit dashboard route | `apps/web/.../episodes/[episodeId]/audit/page.tsx` |
| Audit review route | `apps/web/.../episodes/[episodeId]/audit/[auditId]/page.tsx` |
| Publish gate integration | `packages/features/publishing/src/server/publish-actions.ts` |
| Episode list badges | `packages/features/episodes/src/components/` (modify existing) |
| Publish hub gate | `packages/features/publishing/src/components/` (modify existing) |
