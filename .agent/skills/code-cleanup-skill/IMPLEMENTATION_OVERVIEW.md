# Google Antigravity Workflow: Code Cleanup & Dead Code Removal

## 🎯 Overview

This is a production-ready Antigravity skill designed by a senior engineer for **Makerkit NextJS + Supabase** projects. It provides comprehensive code cleanup and dead code removal capabilities with enterprise-grade safety mechanisms.

## 📦 What's Included

### Complete Skill Package

```
code-cleanup-skill/
├── SKILL.md                          # Main skill definition (Antigravity reads this)
├── QUICK_START.md                    # Installation and quick usage guide
├── README.md                         # Comprehensive documentation
│
├── scripts/                          # 5 Production Scripts
│   ├── analyze_codebase.py          # Dead code detection & analysis
│   ├── remove_dead_code.py          # Safe code removal with backups
│   ├── validate_cleanup.py          # Post-cleanup validation suite
│   ├── create_checkpoint.py         # Safety checkpoint creation
│   └── cleanup_imports.py           # Import statement cleanup
│
├── resources/                        # Reference Documentation
│   ├── makerkit_structure.md        # Makerkit NextJS structure guide
│   ├── supabase_patterns.md         # Supabase cleanup best practices
│   └── safe_removal_checklist.md    # Step-by-step safety checklist
│
└── examples/                         # Real-World Examples
    ├── component_removal_example.md  # Complete component removal walkthrough
    └── database_cleanup_example.md   # Database table removal example
```

## 🚀 Key Features

### 1. **Dead Code Detection**
- ✅ Unused React components (Server & Client)
- ✅ Unreferenced functions and utilities
- ✅ Orphaned imports
- ✅ Deprecated database tables
- ✅ Dead routes and API endpoints
- ✅ Unused environment variables

### 2. **Database Safety**
- ✅ Foreign key constraint checking
- ✅ RLS (Row Level Security) policy detection
- ✅ Trigger and view dependency analysis
- ✅ Reversible migration generation
- ✅ Type regeneration (database.ts)
- ✅ Rollback migrations

### 3. **Safety Mechanisms**
- ✅ Git branch checkpoints
- ✅ Automatic file backups
- ✅ Dry-run mode for all operations
- ✅ Multi-phase validation
- ✅ Rollback support
- ✅ Confidence scoring

### 4. **Makerkit-Specific Intelligence**
- ✅ App Router pattern recognition
- ✅ Server vs Client component handling
- ✅ Barrel export (index.ts) updating
- ✅ Supabase client pattern detection
- ✅ Next.js special files (page.tsx, layout.tsx)
- ✅ Middleware consideration

### 5. **Comprehensive Validation**
- ✅ TypeScript compilation check
- ✅ Import resolution verification
- ✅ Test suite execution
- ✅ Build process validation
- ✅ Database integrity check
- ✅ Bundle size analysis

## 💡 How It Works

### Workflow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   1. DISCOVERY PHASE                        │
│  - Scan entire codebase for dead code                      │
│  - Analyze database schema                                 │
│  - Detect unused imports                                   │
│  - Generate confidence scores                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 2. VALIDATION PHASE                         │
│  - Present findings to user                                │
│  - Check dependencies (foreign keys, RLS)                  │
│  - Verify no dynamic imports                               │
│  - Get explicit user approval                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                3. SAFETY CHECKPOINT                         │
│  - Create git branch (cleanup/checkpoint-YYYYMMDD)         │
│  - Backup database migrations                              │
│  - Create file manifest                                    │
│  - Prepare rollback plan                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   4. REMOVAL PHASE                          │
│  - Remove approved components                              │
│  - Remove approved functions                               │
│  - Generate database drop migrations                       │
│  - Clean up imports                                        │
│  - Update barrel exports                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 5. VERIFICATION PHASE                       │
│  - TypeScript compilation                                  │
│  - Import resolution                                       │
│  - Test suite execution                                    │
│  - Build process                                           │
│  - Generate metrics report                                 │
└─────────────────────────────────────────────────────────────┘
```

## 🎨 Design Philosophy

This skill follows senior engineering principles:

### 1. **Safety First**
- Never delete code without validation
- Always create rollback points
- Prefer false negatives over false positives
- Validate at every step

### 2. **Progressive Disclosure**
- Start with discovery (no changes)
- Show what will happen (dry-run)
- Execute with approval (user confirms)
- Validate after action (checks)

### 3. **Comprehensive Analysis**
- Static code analysis (AST parsing)
- Cross-file dependency tracking
- Database relationship mapping
- Import/export graph building

### 4. **Production Ready**
- Error handling at every step
- Detailed logging and reporting
- Reversible operations
- Comprehensive documentation

## 📋 Usage Scenarios

### Scenario 1: Removing Deprecated Authentication

**Context**: You've migrated from custom auth to Supabase Auth, leaving old components.

```
User: "Remove the deprecated OldAuthForm component and related code"

Agent Process:
1. Searches for OldAuthForm and dependencies
2. Finds: OldAuthForm.tsx, test file, imports
3. Checks database for auth-related tables
4. Creates checkpoint
5. Removes component + test + updates exports
6. Validates TypeScript, builds, tests
7. Reports: -3.2KB bundle size, 47 LOC removed
```

### Scenario 2: Database Table Cleanup

**Context**: Old session management table needs removal.

```
User: "Remove the legacy_sessions table from the database"

Agent Process:
1. Checks foreign keys → finds user_id FK
2. Checks RLS policies → finds 2 policies
3. Checks code references → finds 1 deprecated file
4. Creates reversible migration
5. Drops policies → drops FKs → drops table
6. Regenerates TypeScript types
7. Validates database integrity
8. Reports: -2.3MB database size
```

### Scenario 3: Import Cleanup

**Context**: Project has accumulated unused imports over time.

```
User: "Clean up all unused imports"

Agent Process:
1. Scans all .ts/.tsx files
2. Detects 47 unused imports
3. Shows dry-run preview
4. Removes unused imports
5. Sorts remaining imports
6. Validates TypeScript compilation
7. Reports: Files cleaned, no errors
```

## 🛠️ Technical Implementation

### Script Architecture

#### `analyze_codebase.py`
- **Purpose**: Static analysis engine
- **Technology**: AST parsing, regex matching, graph building
- **Output**: JSON reports with confidence scores
- **Features**:
  - Multi-file dependency tracking
  - Database reference scanning
  - Export/import mapping
  - Deprecated marker detection

#### `remove_dead_code.py`
- **Purpose**: Safe code removal executor
- **Technology**: File operations with backups
- **Features**:
  - Dry-run simulation
  - Automatic backups
  - Barrel export updating
  - Migration generation

#### `validate_cleanup.py`
- **Purpose**: Post-cleanup validation
- **Technology**: Subprocess execution, compilation checks
- **Features**:
  - TypeScript compiler integration
  - Test runner integration
  - Build process validation
  - Import resolution checking

#### `create_checkpoint.py`
- **Purpose**: Safety checkpoint creation
- **Technology**: Git operations, file backup
- **Features**:
  - Git branch creation
  - Database backup
  - File manifest generation

#### `cleanup_imports.py`
- **Purpose**: Import statement optimization
- **Technology**: Regex parsing, AST analysis
- **Features**:
  - Unused import detection
  - Import sorting
  - Duplicate removal

### Safety Mechanisms

1. **Multi-Phase Validation**
   - Pre-validation (before changes)
   - Dry-run simulation
   - Post-validation (after changes)

2. **Rollback Support**
   - Git branches for code rollback
   - Database backup for schema rollback
   - File backups for individual files

3. **Confidence Scoring**
   - High: Zero references, not exported
   - Medium: Exported but unused
   - Low: Special patterns detected (page.tsx, layout.tsx)

## 📊 Metrics & Reporting

The skill generates comprehensive metrics:

### Code Metrics
- Lines of code removed
- Files removed/modified
- Bundle size reduction
- Build time improvement

### Database Metrics
- Tables removed
- Constraints removed
- Database size reduction
- Migration count

### Quality Metrics
- Test coverage maintained
- Zero TypeScript errors
- All tests passing
- Build successful

## 🔧 Customization

The skill is designed to be customizable:

### Adding New Detection Patterns

Edit `analyze_codebase.py`:
```python
# Add new patterns to detect
DEPRECATED_PATTERNS = [
    '@deprecated',
    '// TODO: Remove',
    '// LEGACY',
    '// YOUR_CUSTOM_MARKER',
]
```

### Adding New Validation Checks

Edit `validate_cleanup.py`:
```python
def _check_custom_validation(self) -> bool:
    """Add your custom validation logic"""
    # Your custom checks here
    return True
```

### Configuring Skip Patterns

Edit script constants:
```python
SKIP_DIRS = {
    'node_modules', '.next', '.git',
    'your_custom_skip_dir'
}
```

## 📚 Documentation Structure

### For Users
- **QUICK_START.md**: Get started in 5 minutes
- **README.md**: Complete reference guide
- **SKILL.md**: Detailed workflow instructions

### For Developers
- **resources/**: Technical patterns and best practices
- **examples/**: Real-world walkthroughs
- **scripts/**: Well-documented Python code

## 🎓 Best Practices Encoded

### Makerkit Patterns
- Respects App Router conventions
- Handles server/client component differences
- Updates barrel exports correctly
- Preserves Supabase patterns

### Database Safety
- Always checks foreign keys
- Handles RLS policies
- Creates reversible migrations
- Regenerates types

### Code Quality
- Maintains test coverage
- Preserves TypeScript strict mode
- Follows import conventions
- Updates documentation

## 🚦 Production Readiness

This skill is production-ready because:

✅ **Tested Patterns**: Based on real-world cleanup scenarios
✅ **Safety First**: Multiple validation layers
✅ **Rollback Support**: Always reversible
✅ **Comprehensive Docs**: Examples and guides
✅ **Error Handling**: Graceful failure handling
✅ **Logging**: Detailed operation logs
✅ **Metrics**: Before/after measurements

## 📦 Deliverables

You receive:

1. **Complete Antigravity Skill** - Ready to use
2. **5 Production Scripts** - Fully functional
3. **Comprehensive Documentation** - 8 markdown files
4. **Real Examples** - 2 detailed walkthroughs
5. **Safety Checklists** - Step-by-step guides
6. **Best Practices** - Encoded in resources

## 🎯 Success Criteria

A cleanup is successful when:

✅ All tests pass
✅ TypeScript compiles without errors
✅ Application builds successfully
✅ No runtime errors
✅ Performance is same or better
✅ Documentation is updated
✅ Rollback plan is documented
✅ Team is notified

## 🔮 Future Enhancements

Potential additions:

- Integration with ESLint for dead code detection
- GitHub Actions workflow for automated cleanup
- Slack notifications for cleanup reports
- Dependency graph visualization
- Cost savings calculator
- AI-powered confidence scoring

## 📞 Support

The skill includes:
- Detailed error messages
- Troubleshooting guides
- Rollback instructions
- Example scenarios

## 🎉 Summary

This is a **comprehensive, production-ready, senior-engineer designed** Google Antigravity skill that:

1. **Safely identifies** dead code, deprecated features, and orphaned database objects
2. **Removes them carefully** with multiple safety checkpoints
3. **Validates thoroughly** to ensure nothing breaks
4. **Reports metrics** showing the impact
5. **Supports rollback** if anything goes wrong

**Designed specifically for Makerkit NextJS + Supabase projects** with deep understanding of:
- App Router patterns
- Supabase database safety
- RLS policies
- Server vs Client components
- TypeScript type generation

**Ready to use immediately** - just copy to your `.agent/skills/` directory and start cleaning! 🚀
