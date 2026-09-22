---
spec_id: FILM-201
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-201: Asset CRUD Server Actions

**Phase**: 2
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-101d (assets table)
**Blocks**: FILM-202, FILM-203, FILM-204

---

## Context

The Asset Management system requires server-side actions to handle CRUD operations for assets. These actions serve as the foundation for all asset-related features including character management, location management, and voice profiles. All actions must enforce authentication, validate inputs with Zod schemas, and respect Row-Level Security policies.

Assets are multi-tenant and associated with projects. Each asset has a type (character, location, voice) and can store metadata in a JSONB column. The system must support soft deletes to preserve referential integrity for episodes that reference deleted assets.

---

## Requirements

### Functional Requirements

1. **Create Asset**
   - Accept asset data (name, type, metadata, reference URLs)
   - Validate user has write access to project
   - Insert asset record with proper foreign keys
   - Return created asset with all fields

2. **Get Project Assets**
   - Fetch all assets for a project
   - Support filtering by asset type (character, location, voice)
   - Support pagination (limit/offset)
   - Include soft delete filtering (exclude deleted_at IS NOT NULL)
   - Return assets with metadata

3. **Update Asset**
   - Accept partial asset updates
   - Validate user has write access
   - Update only provided fields
   - Update updated_at timestamp
   - Return updated asset

4. **Delete Asset**
   - Soft delete (set deleted_at timestamp)
   - Validate user has write access
   - Check for dependent records (episodes, shots)
   - Prevent deletion if asset is in use
   - Return success confirmation

### Non-Functional Requirements

- All actions must complete within 2 seconds
- Actions must be idempotent where possible
- Must enforce RLS policies via Supabase client
- Must log errors with context for debugging
- Must validate all inputs with Zod schemas

---

## Interface

### TypeScript Types

```typescript
// Zod Schemas
import { z } from 'zod';

export const CreateAssetSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.enum(['character', 'location', 'voice']),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  referenceImageUrl: z.string().url().optional(),
});

export const GetProjectAssetsSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(['character', 'location', 'voice']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const UpdateAssetSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  referenceImageUrl: z.string().url().optional(),
});

export const DeleteAssetSchema = z.object({
  assetId: z.string().uuid(),
});

// Return Types
export interface Asset {
  id: string;
  projectId: string;
  name: string;
  type: 'character' | 'location' | 'voice';
  description: string | null;
  metadata: Record<string, unknown> | null;
  referenceImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface GetProjectAssetsResponse {
  assets: Asset[];
  total: number;
  hasMore: boolean;
}

export interface DeleteAssetResponse {
  success: boolean;
  assetId: string;
}
```

### Server Actions

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  CreateAssetSchema,
  GetProjectAssetsSchema,
  UpdateAssetSchema,
  DeleteAssetSchema,
} from '../schemas/asset.schema';

/**
 * Creates a new asset for a project
 * @throws {Error} If user lacks project access or validation fails
 */
export const createAssetAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Insert asset
    const { data: asset, error } = await client
      .from('assets')
      .insert({
        project_id: data.projectId,
        name: data.name,
        type: data.type,
        description: data.description ?? null,
        metadata: data.metadata ?? null,
        reference_image_url: data.referenceImageUrl ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return asset;
  },
  { schema: CreateAssetSchema, auth: true }
);

/**
 * Fetches all assets for a project with optional filtering
 * @throws {Error} If user lacks project access
 */
export const getProjectAssetsAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Build query
    let query = client
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    // Apply type filter if provided
    if (data.type) {
      query = query.eq('type', data.type);
    }

    const { data: assets, error, count } = await query;

    if (error) throw error;

    return {
      assets: assets ?? [],
      total: count ?? 0,
      hasMore: (count ?? 0) > data.offset + data.limit,
    };
  },
  { schema: GetProjectAssetsSchema, auth: true }
);

/**
 * Updates an existing asset
 * @throws {Error} If user lacks project access or asset not found
 */
export const updateAssetAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.metadata !== undefined) updates.metadata = data.metadata;
    if (data.referenceImageUrl !== undefined) {
      updates.reference_image_url = data.referenceImageUrl;
    }

    const { data: asset, error } = await client
      .from('assets')
      .update(updates)
      .eq('id', data.assetId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return asset;
  },
  { schema: UpdateAssetSchema, auth: true }
);

/**
 * Soft deletes an asset (sets deleted_at timestamp)
 * @throws {Error} If user lacks access or asset is in use
 */
export const deleteAssetAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Check if asset is referenced by any episodes or shots
    const { count: episodeCount } = await client
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .contains('asset_ids', [data.assetId]);

    if (episodeCount && episodeCount > 0) {
      throw new Error('Cannot delete asset that is referenced by episodes');
    }

    // Soft delete
    const { error } = await client
      .from('assets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', data.assetId)
      .is('deleted_at', null);

    if (error) throw error;

    return {
      success: true,
      assetId: data.assetId,
    };
  },
  { schema: DeleteAssetSchema, auth: true }
);
```

---

## Implementation Details

### File Structure

```
packages/features/assets/src/
├── lib/
│   ├── schemas/
│   │   └── asset.schema.ts         # Zod schemas (CREATE THIS)
│   └── server/
│       ├── mutations/
│       │   └── asset-actions.ts     # CRUD actions (CREATE THIS)
│       └── queries/
│           └── asset-queries.ts     # Read-only queries (CREATE THIS)
└── types/
    └── asset.types.ts               # TypeScript interfaces (CREATE THIS)
```

### Database Queries

**Create Asset**:
```sql
INSERT INTO assets (
  project_id,
  name,
  type,
  description,
  metadata,
  reference_image_url
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
```

**Get Project Assets**:
```sql
SELECT *
FROM assets
WHERE project_id = $1
  AND deleted_at IS NULL
  AND ($2::asset_type IS NULL OR type = $2)
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;
```

**Update Asset**:
```sql
UPDATE assets
SET
  name = COALESCE($2, name),
  description = COALESCE($3, description),
  metadata = COALESCE($4, metadata),
  reference_image_url = COALESCE($5, reference_image_url),
  updated_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;
```

**Delete Asset** (Soft Delete):
```sql
UPDATE assets
SET deleted_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL;
```

### RLS Policy Verification

The following RLS policies must exist on the `assets` table (from FILM-101d):

```sql
-- Users can view assets for projects they have access to
CREATE POLICY "Users can view project assets"
ON assets FOR SELECT
TO authenticated
USING (user_has_project_access(project_id));

-- Users can create assets for projects they have write access
CREATE POLICY "Users can create project assets"
ON assets FOR INSERT
TO authenticated
WITH CHECK (user_has_project_write_access(project_id));

-- Users can update assets for projects they have write access
CREATE POLICY "Users can update project assets"
ON assets FOR UPDATE
TO authenticated
USING (user_has_project_write_access(project_id));

-- Users can delete assets for projects they have write access
CREATE POLICY "Users can delete project assets"
ON assets FOR DELETE
TO authenticated
USING (user_has_project_write_access(project_id));
```

### Error Handling

| Error Condition | Error Code | User Message | HTTP Status |
|----------------|------------|--------------|-------------|
| Invalid UUID | VALIDATION_ERROR | "Invalid asset ID format" | 400 |
| Asset not found | NOT_FOUND | "Asset not found" | 404 |
| No project access | FORBIDDEN | "You don't have access to this project" | 403 |
| Asset in use | CONFLICT | "Cannot delete asset that is in use" | 409 |
| Database error | INTERNAL_ERROR | "Failed to perform operation" | 500 |

### Validation Rules

- **name**: 1-255 characters, required
- **type**: Must be one of: character, location, voice
- **description**: Max 1000 characters, optional
- **metadata**: Valid JSON object, optional
- **referenceImageUrl**: Valid URL format, optional
- **projectId**: Valid UUID, required
- **limit**: 1-100, default 50
- **offset**: >= 0, default 0

---

## File Changes

### New Files

1. **packages/features/assets/src/lib/schemas/asset.schema.ts**
   - Export all Zod schemas
   - Include type inference helpers
   - Add JSDoc comments

2. **packages/features/assets/src/lib/server/mutations/asset-actions.ts**
   - Implement all CRUD actions
   - Use enhanceAction wrapper
   - Include comprehensive error handling

3. **packages/features/assets/src/lib/server/queries/asset-queries.ts**
   - Helper functions for read operations
   - Reusable query builders
   - Type-safe return values

4. **packages/features/assets/src/types/asset.types.ts**
   - Export Asset interface
   - Export all response types
   - Mirror database types

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [x] `createAssetAction` successfully creates asset with valid data
- [x] `createAssetAction` throws error for invalid project ID
- [ ] `createAssetAction` respects RLS (cannot create for inaccessible project) — *audit: unverified* — policy exists (`apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:719`); no pgTAP test exercises it (`apps/web/supabase/tests/database/authors-deletable.test.sql:62` only inserts a fixture as `postgres`)
- [x] `getProjectAssetsAction` returns all non-deleted assets for project
- [x] `getProjectAssetsAction` filters by type when specified
- [x] `getProjectAssetsAction` respects pagination (limit/offset)
- [x] `getProjectAssetsAction` returns correct total count
- [x] `updateAssetAction` updates only provided fields
- [x] `updateAssetAction` updates updated_at timestamp
- [x] `updateAssetAction` throws error for deleted assets
- [x] `deleteAssetAction` soft deletes asset (sets deleted_at)
- [ ] `deleteAssetAction` prevents deletion of assets in use — *audit: not met* — checks dialogue lines only, and ignores that query's error, so a failed check deletes (`packages/features/assets/src/lib/server/asset.queries.ts:139-143`)
- [x] All actions enforce authentication (reject unauthenticated users)

### Non-Functional

- [ ] All actions complete within 2 seconds — *audit: unverified* — runtime timing; nothing measures it
- [x] All inputs validated with Zod schemas
- [ ] All database errors properly caught and thrown — *audit: not met* — `isAssetInUse` drops its count query's error and answers "not in use" (`packages/features/assets/src/lib/server/asset.queries.ts:139-143`)
- [x] TypeScript compiles without errors
- [x] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/lib/server/mutations/__tests__/asset-actions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAssetAction,
  getProjectAssetsAction,
  updateAssetAction,
  deleteAssetAction,
} from '../asset-actions';

// Mock Supabase client
vi.mock('@kit/supabase/server-client');

describe('Asset CRUD Actions', () => {
  describe('createAssetAction', () => {
    it('should create asset with valid data', async () => {
      // Test implementation
    });

    it('should reject invalid asset type', async () => {
      // Test implementation
    });

    it('should enforce authentication', async () => {
      // Test implementation
    });
  });

  describe('getProjectAssetsAction', () => {
    it('should return all project assets', async () => {
      // Test implementation
    });

    it('should filter by asset type', async () => {
      // Test implementation
    });

    it('should respect pagination', async () => {
      // Test implementation
    });

    it('should exclude soft-deleted assets', async () => {
      // Test implementation
    });
  });

  describe('updateAssetAction', () => {
    it('should update only provided fields', async () => {
      // Test implementation
    });

    it('should update updated_at timestamp', async () => {
      // Test implementation
    });

    it('should reject updates to deleted assets', async () => {
      // Test implementation
    });
  });

  describe('deleteAssetAction', () => {
    it('should soft delete asset', async () => {
      // Test implementation
    });

    it('should prevent deletion of assets in use', async () => {
      // Test implementation
    });

    it('should return success response', async () => {
      // Test implementation
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/asset-crud.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('Asset CRUD Integration', () => {
  it('should complete full CRUD lifecycle', async () => {
    // 1. Create asset
    // 2. Read asset
    // 3. Update asset
    // 4. Delete asset
    // 5. Verify soft delete
  });

  it('should enforce RLS policies', async () => {
    // Test with different user contexts
  });

  it('should prevent deletion of assets in use', async () => {
    // Create episode with asset
    // Attempt to delete asset
    // Verify error
  });
});
```

### Manual Testing

1. **Create Asset**
   - Open Supabase Studio
   - Execute: `SELECT * FROM assets WHERE id = '<new-asset-id>'`
   - Verify all fields populated correctly

2. **Get Assets**
   - Create 10 assets of different types
   - Call action with type filter
   - Verify correct assets returned

3. **Update Asset**
   - Update asset name
   - Verify updated_at changed
   - Verify other fields unchanged

4. **Delete Asset**
   - Create asset
   - Delete asset
   - Verify deleted_at set
   - Verify asset excluded from queries

---

## Security Considerations

### Authentication

- All actions require authenticated user via `auth: true`
- User identity retrieved from session token
- No direct user ID parameters accepted

### Authorization

- RLS policies enforce project-level access control
- Helper functions verify team membership
- Write operations require explicit write access

### Input Validation

- All inputs validated with Zod schemas
- UUID format validated for IDs
- URL format validated for reference images
- JSONB metadata sanitized

### SQL Injection Prevention

- Supabase client uses parameterized queries
- No raw SQL string concatenation
- All inputs properly escaped

### Rate Limiting

Consider adding rate limiting in future iteration:
- Max 100 asset creations per hour per user
- Max 1000 reads per hour per user

---

## Error Handling

### Client-Side Error Display

```typescript
'use client';

import { toast } from '@kit/ui/sonner';
import { createAssetAction } from '../lib/server/mutations/asset-actions';

async function handleCreateAsset(data: FormData) {
  try {
    const asset = await createAssetAction(data);
    toast.success('Asset created successfully');
    return asset;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('FORBIDDEN')) {
        toast.error("You don't have access to this project");
      } else if (error.message.includes('VALIDATION')) {
        toast.error('Please check your input and try again');
      } else {
        toast.error('Failed to create asset');
      }
    }
    throw error;
  }
}
```

### Server-Side Logging

```typescript
import { logger } from '@kit/monitoring';

try {
  const asset = await createAssetAction(data);
  logger.info('Asset created', { assetId: asset.id, projectId: data.projectId });
} catch (error) {
  logger.error('Asset creation failed', {
    error,
    userId: user.id,
    projectId: data.projectId,
  });
  throw error;
}
```

---

## Performance Considerations

### Database Indexes

Verify the following indexes exist (from FILM-101d):

```sql
CREATE INDEX idx_assets_project_type ON assets(project_id, type)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_created_at ON assets(created_at DESC)
  WHERE deleted_at IS NULL;
```

### Query Optimization

- Use `select('*')` with caution (specify columns if large metadata)
- Implement cursor-based pagination for large datasets (future)
- Cache asset counts with React Query

### Caching Strategy

```typescript
// Client-side React Query cache
const queryClient = useQueryClient();

// Cache assets for 5 minutes
const { data } = useQuery({
  queryKey: ['assets', projectId, type],
  queryFn: () => getProjectAssetsAction({ projectId, type }),
  staleTime: 5 * 60 * 1000,
});

// Invalidate cache after mutations
await createAssetAction(data);
queryClient.invalidateQueries({ queryKey: ['assets', projectId] });
```

---

## Future Enhancements

1. **Batch Operations**
   - `bulkCreateAssetsAction` for importing multiple assets
   - `bulkDeleteAssetsAction` for cleanup

2. **Asset Duplication**
   - `duplicateAssetAction` to clone existing assets

3. **Asset Search**
   - Full-text search on name and description
   - Metadata field searching

4. **Asset History**
   - Track all changes to assets
   - Implement audit log table

5. **Asset Templates**
   - Predefined asset templates for common characters/locations
   - Template marketplace

---

## References

- **FILM-101d**: Assets table schema
- **Constitution**: Section 2.2 (Server Actions Pattern)
- **Constitution**: Section 3 (Database Conventions)
- **Constitution**: Section 4.1 (RLS Policies)
- **Next.js Actions**: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| In-use check before delete | `isAssetInUse` checks only `dialogue_lines` and never reads the count query's `error`, so a failed check reports "not in use" and the asset is deleted (`packages/features/assets/src/lib/server/asset.queries.ts:139-143`) | unassigned |
| Database errors caught and thrown | The same query's error is dropped rather than thrown | unassigned |
