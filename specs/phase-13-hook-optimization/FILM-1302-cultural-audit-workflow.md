---
spec_id: FILM-1302
title: Cultural Audit Workflow ("The Nuance Gate")
status: Draft
effort: M
dependencies: FILM-1301
---

# Cultural Audit Workflow ("The Nuance Gate")

## 1. Overview
To successfully traverse the 5-language matrix (EN, HI, BN, ES, PT), content cannot simply be translated; it must be **culturally adapted**. The **Cultural Audit Workflow** introduces a human-in-the-loop (or specialized AI agent) gate before publishing to non-primary languages.

## 2. The Workflow

### 2.1 Trigger
- When an episode is marked `Ready for Review` and has `Target Languages` > 1.
- Logic: `IF (Episode.lanugages.includes('es') AND Project.primary_lang != 'es') -> Trigger Audit`.

### 2.2 The Audit Interface (`/studio/[project]/audit`)
A side-by-side view for the auditor:
- **Left**: Original Script/Video (English).
- **Right**: Localized Script/Dub (Spanish).
- **Checklist**:
    1.  **Idiom Check**: "Is 'Hit the road' translated literally?"
    2.  **Tone Check**: "Is Professor Babu too formal or too informal for complete strangers?"
    3.  **Visual Check**: "Does text overlay match the local script?"

### 2.3 Auditor Actions
- **Approve**: Moves to `Ready to Publish`.
- **Request Changes**:
    - Highlights specific timestamp/line.
    - Provides "Cultural Note" (e.g., "In Mexico, we don't use this slang, use X instead.").
    - Auto-generates a task for the Script Editor.

## 3. Data Model

### 3.1 Database Schema
```sql
CREATE TYPE audit_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');

CREATE TABLE cultural_audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  episode_id UUID REFERENCES episodes(id),
  language_code TEXT NOT NULL, -- 'es', 'pt', 'hi', 'bn'
  auditor_id UUID REFERENCES auth.users(id),
  status audit_status DEFAULT 'pending',
  feedback JSONB, -- { "timestamp": "00:12", "note": "Wrong slang" }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 4. Integration with AI Agents
This specifiction prepares the ground for **AI Auditors**.
- Instead of a human `auditor_id`, we can assign an `agent_id`.
- The Agent (configured with a "Mexican Cultural Persona") runs a pre-pass on the script and flags potential issues in the `feedback` JSONB before a human sees it.

## 5. User Interface Extensions
- **Episode List**: New status indicator `Audit Setup` / `Audit Pending` / `Audit Failed`.
- **Publishing Hub**: Block publishing for specific languages until `cultural_audits` status is `approved`.
