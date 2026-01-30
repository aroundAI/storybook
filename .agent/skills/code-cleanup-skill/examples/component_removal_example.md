# Component Removal Example

## Scenario
Remove a deprecated authentication component `OldSignInForm.tsx` that has been replaced by a new implementation.

## Before State

### File: `components/auth/OldSignInForm.tsx`
```typescript
'use client'

import { useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

// DEPRECATED: Use NewSignInForm instead
export function OldSignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const supabase = createClientComponentClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Old auth method - deprecated in Supabase v2
    const { error } = await supabase.auth.signIn({
      email,
      password,
    })
    
    if (error) console.error(error)
  }

  return (
    <form onSubmit={handleSubmit}>
      <input 
        type="email" 
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input 
        type="password" 
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Sign In</button>
    </form>
  )
}
```

### File: `components/auth/index.ts` (Barrel Export)
```typescript
export { NewSignInForm } from './NewSignInForm'
export { OldSignInForm } from './OldSignInForm'  // <- To be removed
export { SignUpForm } from './SignUpForm'
```

### File: `components/auth/OldSignInForm.test.tsx`
```typescript
import { render, screen } from '@testing-library/react'
import { OldSignInForm } from './OldSignInForm'

describe('OldSignInForm', () => {
  it('renders sign in form', () => {
    render(<OldSignInForm />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
```

### Database: No direct database dependencies
The component uses Supabase auth, but no custom tables.

## Analysis Results

```json
{
  "file_path": "components/auth/OldSignInForm.tsx",
  "item_type": "component",
  "item_name": "OldSignInForm",
  "references": [],
  "warnings": [
    "File marked as deprecated",
    "Uses deprecated Supabase auth method"
  ],
  "confidence": "high",
  "last_modified": "2023-06-15"
}
```

## Removal Process

### Step 1: Verify No References
```bash
# Search entire codebase
grep -r "OldSignInForm" . --include="*.tsx" --include="*.ts"

# Results:
# components/auth/OldSignInForm.tsx (definition)
# components/auth/index.ts (export)
# components/auth/OldSignInForm.test.tsx (test)
# No other references found ✅
```

### Step 2: Check for Dynamic Imports
```bash
# Check for dynamic imports
grep -r "import.*OldSignInForm" . --include="*.tsx" --include="*.ts"
grep -r "dynamic.*OldSignInForm" . --include="*.tsx" --include="*.ts"

# No dynamic imports found ✅
```

### Step 3: Create Checkpoint
```bash
python scripts/create_checkpoint.py --name "remove-old-signin-form"

# Output:
# ✅ Created git branch: cleanup/checkpoint-remove-old-signin-form
# ✅ Created code snapshot
```

### Step 4: Remove Files
```bash
# Remove component
rm components/auth/OldSignInForm.tsx

# Remove test
rm components/auth/OldSignInForm.test.tsx
```

### Step 5: Update Barrel Export
```typescript
// components/auth/index.ts
export { NewSignInForm } from './NewSignInForm'
// export { OldSignInForm } from './OldSignInForm'  // REMOVED
export { SignUpForm } from './SignUpForm'
```

### Step 6: Validate
```bash
# Run validation
python scripts/validate_cleanup.py

# Output:
# ✅ TypeScript compilation: PASSED
# ✅ Import resolution: PASSED
# ✅ Test suite: PASSED
# ✅ Build process: PASSED
```

## After State

### Removed Files
- ❌ `components/auth/OldSignInForm.tsx` (deleted)
- ❌ `components/auth/OldSignInForm.test.tsx` (deleted)

### Modified Files
- ✏️ `components/auth/index.ts` (removed export)

### Metrics
- **Files removed**: 2
- **Lines of code removed**: 47
- **Test files removed**: 1
- **Bundle size reduction**: 3.2 KB (gzipped)

## Verification

### Manual Testing
1. ✅ Application starts without errors
2. ✅ Sign in page loads correctly (using NewSignInForm)
3. ✅ No console errors
4. ✅ Tests pass

### TypeScript
```bash
npx tsc --noEmit
# No errors ✅
```

### Build
```bash
npm run build
# Build successful ✅
# Bundle size reduced by 3.2 KB
```

## Rollback Instructions

If needed, rollback using:
```bash
git checkout cleanup/checkpoint-remove-old-signin-form
```

## Lessons Learned

1. **Check barrel exports**: Always update index.ts files
2. **Remove tests**: Don't forget corresponding test files
3. **Search thoroughly**: Use multiple search patterns
4. **Validate early**: Run TypeScript check before committing

## Pull Request Description

```markdown
## Remove deprecated OldSignInForm component

### Summary
Removes the deprecated `OldSignInForm` component that was replaced by `NewSignInForm` in v2.0.0.

### Changes
- Deleted `components/auth/OldSignInForm.tsx`
- Deleted `components/auth/OldSignInForm.test.tsx`
- Updated `components/auth/index.ts` to remove export

### Impact
- Bundle size: -3.2 KB
- Zero usage in codebase (verified via search)
- All tests passing

### Testing
- ✅ TypeScript compilation
- ✅ Build process
- ✅ Manual testing of sign-in flow
- ✅ All unit tests passing

### Rollback
If needed: `git checkout cleanup/checkpoint-remove-old-signin-form`
```

## Success Metrics

✅ Component successfully removed
✅ No broken imports
✅ All tests passing
✅ Application works correctly
✅ Bundle size reduced
✅ Documentation updated
