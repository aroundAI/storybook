# Code Cleanup Skill - Quick Start Guide

## Installation

### Option 1: Project-Specific (Recommended for your Makerkit project)

```bash
# In your Makerkit project root
mkdir -p .agent/skills
cp -r code-cleanup-skill .agent/skills/
```

### Option 2: Global (Available in all projects)

```bash
# For Google Antigravity
mkdir -p ~/.gemini/antigravity/skills
cp -r code-cleanup-skill ~/.gemini/antigravity/skills/
```

## Verify Installation

Your Antigravity agent will automatically detect the skill. You can verify by asking:

```
"What skills do you have for code cleanup?"
```

## Quick Usage Examples

### 1. Find Dead Code

```
"Analyze my codebase for dead code and unused components"
```

The agent will:
- Run `analyze_codebase.py`
- Generate reports in `reports/` directory
- Show you a summary of findings

### 2. Remove a Specific Component

```
"I have a deprecated OldAuthForm component. Can you safely remove it?"
```

The agent will:
- Search for all references
- Create a safety checkpoint
- Remove the component
- Update barrel exports
- Validate the changes

### 3. Clean Up Database

```
"Find and remove orphaned database tables from my Supabase schema"
```

The agent will:
- Scan database migrations
- Check which tables are referenced in code
- Identify orphaned tables
- Create reversible migrations
- Remove tables safely

### 4. Fix Imports

```
"Clean up all unused imports in my project"
```

The agent will:
- Scan all TypeScript/JavaScript files
- Identify unused imports
- Remove them automatically
- Sort remaining imports

## Manual Script Usage (Optional)

If you prefer to run scripts directly:

### Analyze

```bash
cd your-project
python .agent/skills/code-cleanup-skill/scripts/analyze_codebase.py \
  --target . \
  --output reports/
```

### Remove (Dry Run)

```bash
python .agent/skills/code-cleanup-skill/scripts/remove_dead_code.py \
  --target . \
  --components reports/approved_components.json \
  --dry-run
```

### Remove (Execute)

```bash
python .agent/skills/code-cleanup-skill/scripts/remove_dead_code.py \
  --target . \
  --components reports/approved_components.json \
  --execute
```

### Validate

```bash
python .agent/skills/code-cleanup-skill/scripts/validate_cleanup.py \
  --target .
```

## Safety Tips

1. **Always start with analysis**: Understand what's dead before removing
2. **Use dry-run first**: See what will happen before executing
3. **Create checkpoints**: The agent will do this automatically
4. **Review carefully**: Don't blindly approve all suggestions
5. **Test after cleanup**: Run your test suite after removal

## Common Workflows

### Workflow 1: Full Cleanup

```
User: "I want to clean up my entire codebase"

Agent: 
Step 1: "I'll analyze your codebase for dead code"
Step 2: "I found X components, Y functions, and Z database tables"
Step 3: "Should I create a safety checkpoint?"
Step 4: "Removing approved items..."
Step 5: "Validating changes..."
Step 6: "Cleanup complete! Bundle size reduced by X KB"
```

### Workflow 2: Targeted Cleanup

```
User: "Remove the deprecated authentication code"

Agent:
Step 1: "Searching for deprecated auth code..."
Step 2: "Found OldAuthForm and related files"
Step 3: "Creating checkpoint..."
Step 4: "Removing files..."
Step 5: "Updating imports and exports..."
Step 6: "Validation passed!"
```

### Workflow 3: Database Cleanup

```
User: "Clean up old database tables"

Agent:
Step 1: "Analyzing database schema..."
Step 2: "Found 3 orphaned tables: legacy_sessions, old_tokens, deprecated_logs"
Step 3: "Checking foreign key constraints..."
Step 4: "Creating reversible migrations..."
Step 5: "Tables removed. Regenerating types..."
Step 6: "Database cleanup complete!"
```

## File Structure

After installation, you'll have:

```
your-project/
├── .agent/
│   └── skills/
│       └── code-cleanup-skill/
│           ├── SKILL.md              # Skill instructions
│           ├── scripts/              # Automation scripts
│           ├── resources/            # Reference docs
│           └── examples/             # Usage examples
└── reports/                          # Generated analysis reports
    ├── dead_code_analysis.json
    ├── import_analysis.json
    └── database_analysis.json
```

## What the Skill Does Automatically

✅ Scans entire codebase for unused code
✅ Detects orphaned database tables
✅ Creates safety checkpoints (git branch + backups)
✅ Removes files safely
✅ Updates barrel exports (index.ts files)
✅ Cleans up imports
✅ Generates database migrations
✅ Validates all changes
✅ Reports metrics (bundle size, LOC, etc.)

## What You Need to Do

🎯 Review findings and approve removals
🎯 Test the application after cleanup
🎯 Deploy changes to staging first
🎯 Monitor for any issues

## Getting Help

The skill includes comprehensive documentation:

- **Main Skill**: `.agent/skills/code-cleanup-skill/SKILL.md`
- **Makerkit Guide**: `resources/makerkit_structure.md`
- **Supabase Guide**: `resources/supabase_patterns.md`
- **Safety Checklist**: `resources/safe_removal_checklist.md`
- **Examples**: `examples/` directory

## Troubleshooting

### Skill Not Activating

Try:
```
"Use the code-cleanup-dead-code-removal skill to analyze my codebase"
```

### Script Errors

Make sure you're in your project directory:
```bash
cd /path/to/your/makerkit-project
```

### Permission Errors

Make scripts executable:
```bash
chmod +x .agent/skills/code-cleanup-skill/scripts/*.py
```

## Next Steps

1. Install the skill in your project
2. Run an analysis: `"Analyze my codebase for dead code"`
3. Review the reports
4. Start with small, safe removals
5. Build confidence with the process
6. Tackle larger cleanups

## Support

If you run into issues:

1. Check the examples in `examples/`
2. Review the safety checklist in `resources/`
3. Use dry-run mode to preview changes
4. Create checkpoints before major removals
5. Test thoroughly after each cleanup

---

**Ready to start?** Just ask the agent:

```
"Analyze my Makerkit codebase for dead code and deprecated features"
```

The agent will guide you through the entire process! 🚀
