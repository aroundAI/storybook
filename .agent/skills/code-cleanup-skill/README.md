# Code Cleanup & Dead Code Removal Skill

A comprehensive Antigravity skill for safely identifying and removing dead code, deprecated features, and orphaned database objects from Makerkit NextJS + Supabase projects.

## Overview

This skill provides a systematic, senior-engineer approach to code cleanup with:

- **Static Analysis**: Automated detection of unused code and imports
- **Database Analysis**: Identification of orphaned tables and schemas
- **Safety Mechanisms**: Multi-phase validation before any deletion
- **Rollback Support**: Checkpoint creation and restoration
- **Comprehensive Reporting**: Detailed analysis and cleanup reports

## Installation

### For Project-Specific Use (Recommended)

```bash
# Create skills directory in your project
mkdir -p .agent/skills

# Copy the skill
cp -r code-cleanup-skill .agent/skills/
```

### For Global Use

```bash
# Create global skills directory
mkdir -p ~/.gemini/antigravity/skills

# Copy the skill
cp -r code-cleanup-skill ~/.gemini/antigravity/skills/
```

## Directory Structure

```
code-cleanup-skill/
├── SKILL.md                      # Main skill definition
├── scripts/                      # Automation scripts
│   ├── analyze_codebase.py      # Dead code detection
│   ├── remove_dead_code.py      # Safe removal execution
│   ├── validate_cleanup.py      # Post-cleanup validation
│   ├── create_checkpoint.py     # Safety checkpoint creation
│   └── cleanup_imports.py       # Import statement cleanup
├── resources/                    # Reference documentation
│   ├── makerkit_structure.md    # Makerkit directory guide
│   ├── supabase_patterns.md     # Supabase best practices
│   └── safe_removal_checklist.md # Step-by-step checklist
└── examples/                     # Real-world examples
    ├── component_removal_example.md
    └── database_cleanup_example.md
```

## Usage

### Activating the Skill

The skill automatically activates when you mention cleanup-related tasks:

```
"Clean up the deprecated authentication code"
"Remove unused components from the codebase"
"Find and remove dead code"
"Identify orphaned database tables"
```

### Typical Workflow

1. **Analysis Phase**
   ```
   "Analyze the codebase for dead code"
   ```
   The agent will run the analysis script and generate reports.

2. **Review Phase**
   ```
   "Show me what components are unused"
   ```
   Review the findings and confirm what should be removed.

3. **Removal Phase**
   ```
   "Remove the approved dead code"
   ```
   The agent will safely remove the code with backups.

4. **Validation Phase**
   ```
   "Validate the cleanup"
   ```
   The agent will verify everything still works.

## Key Features

### 1. Dead Code Detection

Identifies:
- Unused React components
- Unreferenced functions and utilities
- Orphaned imports
- Deprecated database tables
- Dead routes and API endpoints

### 2. Safety Mechanisms

- **Checkpoints**: Git branches and file backups before changes
- **Dry-run Mode**: Simulate changes before executing
- **Validation Suite**: Comprehensive checks after removal
- **Rollback Support**: Easy restoration if issues arise

### 3. Makerkit-Specific

Handles:
- Next.js App Router patterns
- Supabase RLS policies
- Server vs Client components
- Database migrations
- TypeScript type generation

### 4. Database Safety

Checks for:
- Foreign key constraints
- RLS policies
- Triggers
- Views
- RPC functions

## Scripts Reference

### `analyze_codebase.py`

Scans the codebase and generates analysis reports.

```bash
python scripts/analyze_codebase.py \
  --target /path/to/codebase \
  --output reports/
```

**Outputs:**
- `reports/dead_code_analysis.json` - All dead code findings
- `reports/import_analysis.json` - Unused imports
- `reports/database_analysis.json` - Orphaned database objects

### `remove_dead_code.py`

Safely removes approved dead code.

```bash
# Dry run (recommended first)
python scripts/remove_dead_code.py \
  --target /path/to/codebase \
  --components approved_components.json \
  --functions approved_functions.json \
  --database approved_database.json \
  --dry-run

# Execute removal
python scripts/remove_dead_code.py \
  --target /path/to/codebase \
  --components approved_components.json \
  --execute
```

### `validate_cleanup.py`

Validates the codebase after cleanup.

```bash
python scripts/validate_cleanup.py \
  --target /path/to/codebase \
  --output reports/validation_report.json
```

**Checks:**
- TypeScript compilation
- Import resolution
- Package dependencies
- Database schema integrity
- Test suite execution
- Build process

### `create_checkpoint.py`

Creates safety checkpoint before cleanup.

```bash
python scripts/create_checkpoint.py \
  --name "pre-cleanup-$(date +%Y%m%d)" \
  --target /path/to/codebase
```

**Creates:**
- Git branch for rollback
- Database backup
- File manifest

### `cleanup_imports.py`

Cleans up import statements.

```bash
# Dry run
python scripts/cleanup_imports.py --target /path/to/codebase

# Auto-fix
python scripts/cleanup_imports.py --target /path/to/codebase --auto-fix
```

## Example Interactions

### Example 1: Remove Deprecated Component

```
User: "I have a deprecated OldAuthForm component that's no longer used. Can you help me remove it safely?"

Agent: 
1. Runs analysis to verify component is unused
2. Creates safety checkpoint
3. Removes component file
4. Removes test file
5. Updates barrel exports
6. Validates that everything still works
7. Reports bundle size reduction
```

### Example 2: Clean Up Database

```
User: "We have some old database tables from deprecated features. Can you identify and remove them?"

Agent:
1. Scans database for tables
2. Checks which tables are referenced in code
3. Identifies orphaned tables
4. Shows findings and asks for confirmation
5. Creates reversible migration
6. Drops tables with proper CASCADE handling
7. Regenerates TypeScript types
8. Validates database integrity
```

### Example 3: Import Cleanup

```
User: "Clean up all the unused imports in my components directory"

Agent:
1. Scans all files for imports
2. Identifies which imports are never used
3. Shows dry-run of changes
4. Removes unused imports
5. Sorts remaining imports
6. Verifies TypeScript still compiles
```

## Best Practices

### Before Using This Skill

1. **Commit your work**: Ensure your git working directory is clean
2. **Run tests**: Verify all tests pass before cleanup
3. **Backup database**: Create a database backup if removing tables
4. **Review carefully**: Don't blindly approve removals

### During Cleanup

1. **Start with dry-run**: Always use dry-run mode first
2. **Small batches**: Remove code in small, manageable batches
3. **Verify between steps**: Check that things work after each step
4. **Read warnings**: Pay attention to confidence levels and warnings

### After Cleanup

1. **Run full test suite**: Ensure all tests still pass
2. **Manual testing**: Test affected features manually
3. **Monitor production**: Watch for errors after deployment
4. **Update documentation**: Keep docs in sync with code

## Troubleshooting

### "Cannot find module" errors

The script may have removed a file that was actually needed. Check:
- Dynamic imports
- String-based imports
- Barrel exports (index.ts files)

**Solution**: Restore from checkpoint and investigate the import pattern.

### TypeScript errors after cleanup

The types may be out of sync. Try:

```bash
# Clear cache
rm -rf .next node_modules/.cache

# Regenerate Supabase types
supabase gen types typescript --local > lib/types/database.ts

# Recheck
npx tsc --noEmit
```

### Tests failing after cleanup

A test may have dependencies on removed code. Check:
- Mock files in `__mocks__/`
- Test utilities
- Test fixtures

### Database migration fails

Check for:
- Foreign key constraints
- Active connections to the table
- RLS policies that need to be dropped first

**Solution**: Update the migration to handle dependencies first.

## Rollback

If anything goes wrong:

```bash
# Rollback code
git checkout cleanup/checkpoint-YYYYMMDD

# Rollback database (if needed)
cd backups/pre-cleanup-YYYYMMDD
psql -U postgres -d your_db < migrations/backup.sql

# Verify
npm run build
npm test
```

## Contributing

To improve this skill:

1. Add new detection patterns to `analyze_codebase.py`
2. Enhance safety checks in `validate_cleanup.py`
3. Add more examples to the `examples/` directory
4. Update resource documentation as best practices evolve

## Safety Philosophy

This skill follows these principles:

1. **Verify before action**: Always check before removing
2. **Provide rollback**: Always create a way to undo
3. **Fail safely**: Prefer false negatives over false positives
4. **Communicate clearly**: Show what will happen before it happens
5. **Validate after**: Always check that things still work

## Requirements

- Python 3.8+
- Node.js 18+
- Git
- Supabase CLI (for database cleanup)
- TypeScript (for TypeScript projects)

## License

This skill is provided as-is for use with Google Antigravity.

## Support

For issues or questions:
1. Check the examples in `examples/`
2. Review the resources in `resources/`
3. Run with `--dry-run` first to see what would happen
4. Create a checkpoint before any destructive operations

---

**Remember**: This skill is powerful. Always review its suggestions before approving any code removal.
