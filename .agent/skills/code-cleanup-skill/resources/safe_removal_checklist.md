# Safe Code Removal Checklist

Use this checklist before removing any code from your codebase.

## Pre-Removal Phase

### Discovery
- [ ] Run `analyze_codebase.py` to identify dead code
- [ ] Review all generated reports
- [ ] Verify items are truly unused (not dynamically imported)
- [ ] Check for feature flags that might enable this code
- [ ] Search for string references (table names, function names)
- [ ] Check environment variables (.env files)

### Documentation
- [ ] Document why this code is being removed
- [ ] Note the original purpose of the code
- [ ] Identify who originally wrote it (git blame)
- [ ] Check if there are related tickets/issues

### Team Communication
- [ ] Notify team members about planned removal
- [ ] Ask if anyone knows of hidden dependencies
- [ ] Schedule removal during low-traffic period
- [ ] Get approval from tech lead/architect

## Safety Checkpoint

### Backup
- [ ] Run `create_checkpoint.py` to create safety checkpoint
- [ ] Verify git branch was created
- [ ] Verify database backup exists
- [ ] Verify code snapshot is complete
- [ ] Test restoration process

### Analysis
- [ ] No TypeScript errors exist currently
- [ ] All tests are passing currently
- [ ] Application builds successfully currently
- [ ] Database migrations are up-to-date

## Component Removal

### Before Removing a Component
- [ ] Component is not imported anywhere
- [ ] Component is not used in any route (page.tsx, layout.tsx)
- [ ] No dynamic imports reference this component
- [ ] No test files depend on this component
- [ ] Component is not referenced in Storybook

### Component Removal Steps
- [ ] Remove the component file
- [ ] Remove corresponding test file (.test.tsx, .spec.tsx)
- [ ] Remove from barrel exports (index.ts)
- [ ] Remove from documentation
- [ ] Remove from Storybook if applicable

## Function Removal

### Before Removing a Function
- [ ] Function has zero call sites
- [ ] Function is not exported or only locally exported
- [ ] Function is not called via string reference/reflection
- [ ] Function is not part of public API
- [ ] No webhooks or external services call this function

### Function Removal Steps
- [ ] Remove the function definition
- [ ] Remove from exports if applicable
- [ ] Remove tests for this function
- [ ] Remove from API documentation
- [ ] Update related comments

## Database Table Removal

### Before Removing a Table
- [ ] Table has no foreign key references
- [ ] No RLS policies reference this table
- [ ] No triggers reference this table
- [ ] No views use this table
- [ ] No RPC functions query this table
- [ ] No application code references this table
- [ ] No external services use this table
- [ ] No webhooks interact with this table

### Database Removal Steps
- [ ] Run SQL dependency check queries
- [ ] Create reversible migration
- [ ] Test migration in local environment
- [ ] Back up table data (if needed)
- [ ] Drop foreign key constraints first
- [ ] Drop triggers
- [ ] Drop RLS policies
- [ ] Drop the table with CASCADE if needed
- [ ] Create down migration for rollback
- [ ] Test rollback migration

### After Database Removal
- [ ] Regenerate TypeScript types (`supabase gen types`)
- [ ] Remove type references in code
- [ ] Update database documentation
- [ ] Remove from ER diagrams

## Import Cleanup

### Before Cleaning Imports
- [ ] Identify unused imports
- [ ] Verify imports are truly unused (check for side effects)
- [ ] Check for type-only imports

### Import Cleanup Steps
- [ ] Run `cleanup_imports.py --dry-run` first
- [ ] Review proposed changes
- [ ] Run `cleanup_imports.py --auto-fix`
- [ ] Verify no TypeScript errors
- [ ] Verify application still builds

## Route/API Endpoint Removal

### Before Removing a Route
- [ ] Route is not linked from anywhere
- [ ] No redirects point to this route
- [ ] No external systems call this endpoint
- [ ] Route is not in sitemap
- [ ] Route is not in analytics tracking

### Route Removal Steps
- [ ] Remove the route file
- [ ] Update navigation components
- [ ] Update redirects configuration
- [ ] Remove from robots.txt if applicable
- [ ] Update sitemap.xml

## Validation Phase

### After Removal
- [ ] Run `validate_cleanup.py`
- [ ] TypeScript compiles without errors
- [ ] All imports resolve correctly
- [ ] Database migrations are valid
- [ ] Test suite passes (all tests)
- [ ] Application builds successfully
- [ ] No console errors in dev mode

### Manual Testing
- [ ] Test related features manually
- [ ] Check pages that were near removed code
- [ ] Verify authentication still works
- [ ] Verify database operations work
- [ ] Test on multiple devices/browsers

### Performance Check
- [ ] Measure bundle size reduction
- [ ] Check for improved build time
- [ ] Verify no performance regressions
- [ ] Check database query performance

## Post-Removal Phase

### Documentation
- [ ] Update README.md
- [ ] Update API documentation
- [ ] Update architecture diagrams
- [ ] Document the removal in changelog
- [ ] Update environment variable documentation

### Communication
- [ ] Create pull request with clear description
- [ ] Add before/after metrics
- [ ] List all files changed
- [ ] Explain why code was removed
- [ ] Tag reviewers

### Monitoring
- [ ] Monitor error logs after deployment
- [ ] Watch for 404 errors on removed routes
- [ ] Monitor database for errors
- [ ] Check user feedback channels
- [ ] Set up alerts for related errors

## Rollback Plan

### If Something Goes Wrong
- [ ] Know how to access the checkpoint branch
- [ ] Know how to restore database backup
- [ ] Have rollback migration ready
- [ ] Communicate rollback plan to team
- [ ] Document rollback procedure

### Rollback Steps
```bash
# 1. Rollback code
git checkout cleanup/checkpoint-YYYYMMDD

# 2. Rollback database (if needed)
psql < backups/pre-cleanup-YYYYMMDD/migrations/rollback.sql

# 3. Verify rollback
npm run build
npm test

# 4. Deploy rollback to production
```

## Success Criteria

Code removal is successful when:
- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] Application builds successfully
- [ ] No runtime errors in dev/staging
- [ ] Performance is same or better
- [ ] Documentation is updated
- [ ] Team is notified
- [ ] Changes are deployed to production
- [ ] No issues reported within 24 hours

## Red Flags

Stop and investigate if:
- ❌ Tests start failing unexpectedly
- ❌ TypeScript shows strange errors
- ❌ Build fails with cryptic errors
- ❌ Database migration fails
- ❌ Application throws runtime errors
- ❌ Bundle size increases instead of decreases
- ❌ Performance degrades
- ❌ Users report issues

## Emergency Contacts

If issues arise:
1. **Rollback immediately** using checkpoint
2. **Notify tech lead**
3. **Document the issue**
4. **Investigate in staging environment**
5. **Create post-mortem**

## Final Verification

Before merging:
- [ ] All checklist items completed
- [ ] Code review approved
- [ ] Tests passing in CI/CD
- [ ] Staging deployment successful
- [ ] Documentation updated
- [ ] Rollback plan documented
- [ ] Team notified of deployment
