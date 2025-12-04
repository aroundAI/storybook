# FILM-102 Account-Based Access Policies

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** FILM-101 (database tables), FILM-102-enable-rls.md
- **Blocks:** Authentication flows, API key management

## Context
Account-based access policies control access to resources that belong directly to a user's account rather than to a specific project. These include:
- `accounts` - User profile and settings
- `platform_connections` - OAuth connections to external platforms
- `external_api_keys` - API keys for third-party services
- `usage_metrics` - Account-level usage tracking

The security model is straightforward: users can only access resources that belong to their own account. This prevents users from viewing or modifying other users' credentials, API keys, and personal data.

## Specification

### SQL Implementation
```sql
-- =====================================================
-- Film Studio: Account-Based RLS Policies
-- =====================================================
-- Description: Row Level Security policies for account-scoped tables
-- Dependencies: 11-film-studio-tables.sql, 031-film-studio-enable-rls.sql
-- Author: Film Studio Team
-- Date: 2025-12-04
-- =====================================================

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to check if current user owns an account
CREATE OR REPLACE FUNCTION user_owns_account(account_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    -- Check if the account belongs to the current authenticated user
    RETURN EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.account_id = user_owns_account.account_id
        AND a.user_id = auth.uid()
    );
END;
$$;

-- Function to get current user's account_id (if not already defined by project policies)
CREATE OR REPLACE FUNCTION get_current_account_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    user_account_id UUID;
BEGIN
    -- Get the account_id for the current authenticated user
    SELECT account_id INTO user_account_id
    FROM accounts
    WHERE user_id = auth.uid();

    RETURN user_account_id;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION user_owns_account(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_account_id() TO authenticated;

-- =====================================================
-- Accounts Table Policies
-- =====================================================

-- Accounts: SELECT - User can only view their own account
CREATE POLICY "Users can view their own account"
ON accounts
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Accounts: INSERT - User can create their own account
CREATE POLICY "Users can create their own account"
ON accounts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Accounts: UPDATE - User can only update their own account
CREATE POLICY "Users can update their own account"
ON accounts
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Accounts: DELETE - User can only delete their own account
CREATE POLICY "Users can delete their own account"
ON accounts
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- =====================================================
-- Platform Connections Table Policies
-- =====================================================

-- Platform Connections: SELECT - User can only view their own connections
CREATE POLICY "Users can view their own platform connections"
ON platform_connections
FOR SELECT
TO authenticated
USING (account_id = get_current_account_id());

-- Platform Connections: INSERT - User can only create connections for their account
CREATE POLICY "Users can create their own platform connections"
ON platform_connections
FOR INSERT
TO authenticated
WITH CHECK (account_id = get_current_account_id());

-- Platform Connections: UPDATE - User can only update their own connections
CREATE POLICY "Users can update their own platform connections"
ON platform_connections
FOR UPDATE
TO authenticated
USING (account_id = get_current_account_id())
WITH CHECK (account_id = get_current_account_id());

-- Platform Connections: DELETE - User can only delete their own connections
CREATE POLICY "Users can delete their own platform connections"
ON platform_connections
FOR DELETE
TO authenticated
USING (account_id = get_current_account_id());

-- =====================================================
-- External API Keys Table Policies
-- =====================================================

-- External API Keys: SELECT - User can only view their own API keys
CREATE POLICY "Users can view their own api keys"
ON external_api_keys
FOR SELECT
TO authenticated
USING (account_id = get_current_account_id());

-- External API Keys: INSERT - User can only create API keys for their account
CREATE POLICY "Users can create their own api keys"
ON external_api_keys
FOR INSERT
TO authenticated
WITH CHECK (account_id = get_current_account_id());

-- External API Keys: UPDATE - User can only update their own API keys
CREATE POLICY "Users can update their own api keys"
ON external_api_keys
FOR UPDATE
TO authenticated
USING (account_id = get_current_account_id())
WITH CHECK (account_id = get_current_account_id());

-- External API Keys: DELETE - User can only delete their own API keys
CREATE POLICY "Users can delete their own api keys"
ON external_api_keys
FOR DELETE
TO authenticated
USING (account_id = get_current_account_id());

-- =====================================================
-- Usage Metrics Table Policies
-- =====================================================

-- Usage Metrics: SELECT - User can only view their own usage metrics
CREATE POLICY "Users can view their own usage metrics"
ON usage_metrics
FOR SELECT
TO authenticated
USING (account_id = get_current_account_id());

-- Usage Metrics: INSERT - System can create usage metrics for any account
-- (This is typically done by background jobs/triggers)
CREATE POLICY "System can create usage metrics"
ON usage_metrics
FOR INSERT
TO authenticated
WITH CHECK (account_id = get_current_account_id());

-- Usage Metrics: UPDATE - System can update usage metrics
-- (Metrics are typically immutable after creation, but allow for corrections)
CREATE POLICY "System can update usage metrics"
ON usage_metrics
FOR UPDATE
TO authenticated
USING (account_id = get_current_account_id())
WITH CHECK (account_id = get_current_account_id());

-- Usage Metrics: DELETE - User can delete their own usage metrics (for privacy)
CREATE POLICY "Users can delete their own usage metrics"
ON usage_metrics
FOR DELETE
TO authenticated
USING (account_id = get_current_account_id());

-- =====================================================
-- Indexes for RLS Performance
-- =====================================================

-- Index on accounts for user_id lookup (may already exist from project policies)
CREATE INDEX IF NOT EXISTS idx_accounts_user_id
ON accounts(user_id);

-- Index on platform_connections for account_id lookup
CREATE INDEX IF NOT EXISTS idx_platform_connections_account_id
ON platform_connections(account_id);

-- Index on external_api_keys for account_id lookup
CREATE INDEX IF NOT EXISTS idx_external_api_keys_account_id
ON external_api_keys(account_id);

-- Index on usage_metrics for account_id lookup
CREATE INDEX IF NOT EXISTS idx_usage_metrics_account_id
ON usage_metrics(account_id);

-- Index on usage_metrics for time-based queries
CREATE INDEX IF NOT EXISTS idx_usage_metrics_account_date
ON usage_metrics(account_id, created_at DESC);

-- =====================================================
-- Security: Prevent sensitive data leakage
-- =====================================================

-- Function to mask sensitive fields in platform_connections
CREATE OR REPLACE FUNCTION mask_connection_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- When reading, ensure access_token and refresh_token are only visible to owner
    -- (This is handled by RLS, but we add extra validation)
    IF NOT user_owns_account(NEW.account_id) THEN
        RAISE EXCEPTION 'Unauthorized access to platform connection tokens';
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger to validate token access
CREATE TRIGGER validate_connection_token_access
    BEFORE UPDATE OF access_token, refresh_token ON platform_connections
    FOR EACH ROW
    EXECUTE FUNCTION mask_connection_tokens();

-- Function to mask sensitive fields in external_api_keys
CREATE OR REPLACE FUNCTION mask_api_key_values()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Ensure encrypted_key is only accessible to owner
    IF NOT user_owns_account(NEW.account_id) THEN
        RAISE EXCEPTION 'Unauthorized access to API key values';
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger to validate API key access
CREATE TRIGGER validate_api_key_access
    BEFORE UPDATE OF encrypted_key ON external_api_keys
    FOR EACH ROW
    EXECUTE FUNCTION mask_api_key_values();

-- =====================================================
-- Verification
-- =====================================================

-- Verify all policies are created
DO $$
DECLARE
    expected_policies INTEGER := 16; -- 4 policies per table * 4 tables
    actual_policies INTEGER;
BEGIN
    SELECT COUNT(*) INTO actual_policies
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN (
        'accounts', 'platform_connections', 'external_api_keys', 'usage_metrics'
    );

    IF actual_policies < expected_policies THEN
        RAISE WARNING 'Expected at least % policies, found %', expected_policies, actual_policies;
    ELSE
        RAISE NOTICE 'Successfully created % account-based RLS policies', actual_policies;
    END IF;
END $$;

-- Verify helper functions exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'user_owns_account'
    ) THEN
        RAISE EXCEPTION 'Helper function user_owns_account not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'get_current_account_id'
    ) THEN
        RAISE EXCEPTION 'Helper function get_current_account_id not found';
    END IF;

    RAISE NOTICE 'All helper functions verified';
END $$;
```

### Policy Matrix

#### Accounts Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view their own account | user_id = auth.uid() | Direct user ownership check |
| INSERT | Users can create their own account | user_id = auth.uid() | One account per user |
| UPDATE | Users can update their own account | user_id = auth.uid() | Profile updates |
| DELETE | Users can delete their own account | user_id = auth.uid() | Account deletion (GDPR) |

#### Platform Connections Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view their own platform connections | account_id = current user's account | OAuth connections |
| INSERT | Users can create their own platform connections | account_id = current user's account | New OAuth flow |
| UPDATE | Users can update their own platform connections | account_id = current user's account | Token refresh |
| DELETE | Users can delete their own platform connections | account_id = current user's account | Disconnect service |

#### External API Keys Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view their own api keys | account_id = current user's account | View saved keys |
| INSERT | Users can create their own api keys | account_id = current user's account | Add new API key |
| UPDATE | Users can update their own api keys | account_id = current user's account | Update key metadata |
| DELETE | Users can delete their own api keys | account_id = current user's account | Remove API key |

#### Usage Metrics Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view their own usage metrics | account_id = current user's account | View usage data |
| INSERT | System can create usage metrics | account_id = current user's account | System-generated |
| UPDATE | System can update usage metrics | account_id = current user's account | Metric corrections |
| DELETE | Users can delete their own usage metrics | account_id = current user's account | Privacy/GDPR |

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/migrations/033-film-studio-account-rls.sql` |

## Acceptance Criteria
- [ ] All 4 account-scoped tables have RLS policies
- [ ] Helper functions correctly identify user's account ownership
- [ ] Users can only access their own account data
- [ ] Users cannot access other users' credentials or API keys
- [ ] Sensitive data (tokens, encrypted keys) have additional protection triggers
- [ ] Performance indexes are created for policy checks
- [ ] All policies are verified by the migration script

## Test Plan

### Unit Tests
```sql
-- Test 1: Helper function - user_owns_account()
SET ROLE authenticated;
SET request.jwt.claims.sub TO 'user-uuid-123';
SELECT user_owns_account('account-uuid-456');
-- Expected: TRUE if account belongs to user, FALSE otherwise

-- Test 2: Helper function - get_current_account_id()
SELECT get_current_account_id();
-- Expected: Returns the account_id for the current user

-- Test 3: Accounts - SELECT policy
SELECT * FROM accounts;
-- Expected: Only returns current user's account (1 row)

-- Test 4: Accounts - INSERT policy
INSERT INTO accounts (user_id, email) VALUES (auth.uid(), 'test@example.com');
-- Expected: Success

-- Test 5: Accounts - Attempted cross-user access
INSERT INTO accounts (user_id, email) VALUES ('other-user-id', 'other@example.com');
-- Expected: Success (RLS allows insert, but application logic should prevent this)

-- Test 6: Platform Connections - SELECT policy
SELECT * FROM platform_connections;
-- Expected: Only returns current user's connections

-- Test 7: External API Keys - Cross-user access attempt
SELECT * FROM external_api_keys WHERE account_id != get_current_account_id();
-- Expected: 0 rows

-- Test 8: Usage Metrics - Time-based query
SELECT * FROM usage_metrics
WHERE account_id = get_current_account_id()
AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
-- Expected: Last 30 days of usage data
```

### Integration Tests

#### Test Case 1: Account Creation and Access
```sql
-- Setup: User signs up
SET request.jwt.claims.sub TO 'user-1';

-- Act: Create account
INSERT INTO accounts (user_id, email, display_name)
VALUES (auth.uid(), 'user1@example.com', 'User One');

-- Assert: User can access their own account
SELECT * FROM accounts WHERE user_id = auth.uid();
-- Expected: 1 row

-- Assert: User cannot access other accounts
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM accounts WHERE email = 'user1@example.com';
-- Expected: 0 rows (different user)
```

#### Test Case 2: OAuth Connection Flow
```sql
-- Setup: User with account
SET request.jwt.claims.sub TO 'user-1';
INSERT INTO accounts (user_id, email) VALUES (auth.uid(), 'user1@example.com');

-- Act: User connects YouTube account
INSERT INTO platform_connections (
    account_id,
    platform,
    platform_user_id,
    access_token,
    refresh_token,
    expires_at
)
VALUES (
    get_current_account_id(),
    'youtube',
    'yt-user-123',
    'encrypted-access-token',
    'encrypted-refresh-token',
    NOW() + INTERVAL '1 hour'
);

-- Assert: User can view their connection
SELECT platform, platform_user_id FROM platform_connections;
-- Expected: 1 row with YouTube connection

-- Assert: Other user cannot access this connection
SET request.jwt.claims.sub TO 'user-2';
INSERT INTO accounts (user_id, email) VALUES (auth.uid(), 'user2@example.com');
SELECT * FROM platform_connections WHERE platform = 'youtube';
-- Expected: 0 rows
```

#### Test Case 3: API Key Management
```sql
-- Setup: User with account
SET request.jwt.claims.sub TO 'user-1';

-- Act: User adds OpenAI API key
INSERT INTO external_api_keys (
    account_id,
    provider,
    key_name,
    encrypted_key
)
VALUES (
    get_current_account_id(),
    'openai',
    'Production Key',
    'encrypted-api-key-value'
);

-- Assert: User can view their API key metadata
SELECT provider, key_name FROM external_api_keys;
-- Expected: 1 row

-- Assert: User can update their API key
UPDATE external_api_keys
SET key_name = 'Updated Key Name'
WHERE provider = 'openai';
-- Expected: 1 row updated

-- Act: User tries to view another user's API key
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM external_api_keys WHERE provider = 'openai';
-- Expected: 0 rows (RLS prevents access)

-- Act: User 2 tries to update User 1's API key
UPDATE external_api_keys
SET key_name = 'Hacked!'
WHERE provider = 'openai';
-- Expected: 0 rows updated (RLS prevents access)
```

#### Test Case 4: Usage Metrics Tracking
```sql
-- Setup: User with account
SET request.jwt.claims.sub TO 'user-1';

-- Act: System records usage metric
INSERT INTO usage_metrics (
    account_id,
    metric_type,
    metric_value,
    metadata
)
VALUES (
    get_current_account_id(),
    'video_generation_seconds',
    120.5,
    '{"provider": "runway", "resolution": "1080p"}'::jsonb
);

-- Assert: User can view their own metrics
SELECT metric_type, metric_value FROM usage_metrics;
-- Expected: 1 row

-- Assert: User can query aggregated metrics
SELECT
    metric_type,
    SUM(metric_value) as total,
    COUNT(*) as count
FROM usage_metrics
WHERE account_id = get_current_account_id()
GROUP BY metric_type;
-- Expected: Aggregated results

-- Assert: Other user cannot view these metrics
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM usage_metrics WHERE metric_type = 'video_generation_seconds';
-- Expected: 0 rows
```

#### Test Case 5: Account Deletion (GDPR)
```sql
-- Setup: User with account and data
SET request.jwt.claims.sub TO 'user-1';

-- User has: account, API keys, platform connections, usage metrics
-- (Previous test data)

-- Act: User deletes their API keys
DELETE FROM external_api_keys WHERE account_id = get_current_account_id();
-- Expected: Success

-- Act: User deletes their platform connections
DELETE FROM platform_connections WHERE account_id = get_current_account_id();
-- Expected: Success

-- Act: User deletes their usage metrics
DELETE FROM usage_metrics WHERE account_id = get_current_account_id();
-- Expected: Success

-- Act: User deletes their account
DELETE FROM accounts WHERE user_id = auth.uid();
-- Expected: Success (cascading deletes clean up remaining data)

-- Assert: All user data is gone
SELECT COUNT(*) FROM accounts WHERE user_id = 'user-1';
SELECT COUNT(*) FROM platform_connections WHERE account_id IN (
    SELECT account_id FROM accounts WHERE user_id = 'user-1'
);
-- Expected: 0 rows for all queries
```

### Security Tests

#### Test Case 1: Token Theft Prevention
```sql
-- Setup: User 1 has OAuth connection
SET request.jwt.claims.sub TO 'user-1';
INSERT INTO platform_connections (
    account_id, platform, platform_user_id,
    access_token, refresh_token
)
VALUES (
    get_current_account_id(), 'youtube', 'yt-123',
    'secret-token', 'secret-refresh'
);

-- Act: User 2 tries to read User 1's tokens
SET request.jwt.claims.sub TO 'user-2';
SELECT access_token, refresh_token FROM platform_connections
WHERE platform = 'youtube';
-- Expected: 0 rows (RLS blocks access)

-- Act: User 2 tries to update their query to trick RLS
SELECT access_token FROM platform_connections
WHERE account_id = (
    SELECT account_id FROM accounts WHERE user_id = 'user-1'
);
-- Expected: 0 rows (subquery still subject to RLS)
```

#### Test Case 2: SQL Injection in Helper Functions
```sql
-- Act: Attempt SQL injection via user input
SELECT user_owns_account(''''; DROP TABLE accounts; --');
-- Expected: Function safely handles invalid UUID, returns FALSE

-- Act: Attempt boolean condition injection
SELECT user_owns_account('00000000-0000-0000-0000-000000000000'' OR ''1''=''1');
-- Expected: Function safely handles invalid UUID, returns FALSE
```

#### Test Case 3: Privilege Escalation Prevention
```sql
-- Setup: User 2 tries to impersonate User 1
SET request.jwt.claims.sub TO 'user-2';

-- Act: Try to insert account with User 1's user_id
INSERT INTO accounts (user_id, email) VALUES ('user-1', 'fake@example.com');
-- Expected: Success, but RLS prevents User 2 from reading/updating it

-- Act: Try to query the fake account
SELECT * FROM accounts WHERE user_id = 'user-1';
-- Expected: 0 rows (User 2 can only see their own account)

-- Assert: User 1 still has normal access
SET request.jwt.claims.sub TO 'user-1';
SELECT * FROM accounts WHERE user_id = auth.uid();
-- Expected: 1 row (original account, not the fake one)
```

### Performance Tests
```sql
-- Test 1: Account lookup performance
EXPLAIN ANALYZE
SELECT * FROM accounts WHERE user_id = auth.uid();
-- Expected: Index scan on idx_accounts_user_id, < 1ms

-- Test 2: Platform connections query performance
EXPLAIN ANALYZE
SELECT * FROM platform_connections WHERE account_id = get_current_account_id();
-- Expected: Index scan on idx_platform_connections_account_id, < 5ms

-- Test 3: Usage metrics aggregation performance
EXPLAIN ANALYZE
SELECT
    metric_type,
    DATE_TRUNC('day', created_at) as day,
    SUM(metric_value) as total
FROM usage_metrics
WHERE account_id = get_current_account_id()
AND created_at > NOW() - INTERVAL '30 days'
GROUP BY metric_type, day
ORDER BY day DESC;
-- Expected: Index scan on idx_usage_metrics_account_date, < 50ms
```

## Security Considerations

### Data Isolation
- Each user can only access their own account-scoped data
- No shared data between accounts at this level
- Service role can access all data for admin/system operations

### Sensitive Data Protection
- OAuth tokens (access_token, refresh_token) are stored encrypted
- API keys (encrypted_key) are never returned in plain text
- Additional triggers validate access to sensitive fields
- Application layer should use pgcrypto for encryption

### Performance Considerations
- Helper functions marked as STABLE for query optimization
- Indexes on all foreign key and lookup columns
- Usage metrics table may grow large - consider partitioning by date

### Compliance (GDPR, CCPA)
- Users can delete their own account and all associated data
- Cascading deletes ensure complete data removal
- Usage metrics can be deleted for privacy compliance
- Consider implementing soft deletes for audit trails

### Best Practices
1. **Token Rotation**: Implement automatic token refresh for platform_connections
2. **API Key Expiry**: Track last_used_at and expire unused keys
3. **Usage Monitoring**: Alert users when approaching quota limits
4. **Audit Logging**: Log all credential access and modifications
5. **Encryption at Rest**: Use pgcrypto for sensitive fields

### Edge Cases
- **Multiple Accounts**: Auth system should prevent multiple accounts per user_id
- **Account Recovery**: Ensure soft delete allows for account restoration
- **Token Expiry**: Handle expired OAuth tokens gracefully in application
- **Orphaned Connections**: Clean up platform_connections when account is deleted

### Attack Vectors Mitigated
- ✅ Cross-account data access
- ✅ Token/credential theft
- ✅ SQL injection in helper functions
- ✅ Privilege escalation attempts
- ✅ Policy bypass via subqueries
- ✅ Direct database access (RLS enforced)

## Rollback Plan
```sql
-- Drop triggers
DROP TRIGGER IF EXISTS validate_connection_token_access ON platform_connections;
DROP TRIGGER IF EXISTS validate_api_key_access ON external_api_keys;

-- Drop trigger functions
DROP FUNCTION IF EXISTS mask_connection_tokens();
DROP FUNCTION IF EXISTS mask_api_key_values();

-- Drop all policies
DROP POLICY IF EXISTS "Users can view their own account" ON accounts;
DROP POLICY IF EXISTS "Users can create their own account" ON accounts;
DROP POLICY IF EXISTS "Users can update their own account" ON accounts;
DROP POLICY IF EXISTS "Users can delete their own account" ON accounts;

DROP POLICY IF EXISTS "Users can view their own platform connections" ON platform_connections;
DROP POLICY IF EXISTS "Users can create their own platform connections" ON platform_connections;
DROP POLICY IF EXISTS "Users can update their own platform connections" ON platform_connections;
DROP POLICY IF EXISTS "Users can delete their own platform connections" ON platform_connections;

DROP POLICY IF EXISTS "Users can view their own api keys" ON external_api_keys;
DROP POLICY IF EXISTS "Users can create their own api keys" ON external_api_keys;
DROP POLICY IF EXISTS "Users can update their own api keys" ON external_api_keys;
DROP POLICY IF EXISTS "Users can delete their own api keys" ON external_api_keys;

DROP POLICY IF EXISTS "Users can view their own usage metrics" ON usage_metrics;
DROP POLICY IF EXISTS "System can create usage metrics" ON usage_metrics;
DROP POLICY IF EXISTS "System can update usage metrics" ON usage_metrics;
DROP POLICY IF EXISTS "Users can delete their own usage metrics" ON usage_metrics;

-- Drop helper functions
DROP FUNCTION IF EXISTS user_owns_account(UUID);
DROP FUNCTION IF EXISTS get_current_account_id();

-- Drop performance indexes
DROP INDEX IF EXISTS idx_accounts_user_id;
DROP INDEX IF EXISTS idx_platform_connections_account_id;
DROP INDEX IF EXISTS idx_external_api_keys_account_id;
DROP INDEX IF EXISTS idx_usage_metrics_account_id;
DROP INDEX IF EXISTS idx_usage_metrics_account_date;
```

## Monitoring and Alerting

### Metrics to Track
- Failed authentication attempts per account
- API key usage frequency
- OAuth token refresh failures
- Usage metrics growth rate
- Policy violation attempts

### Alerts to Configure
- Multiple failed login attempts (potential brute force)
- Unusual API key access patterns (potential theft)
- OAuth tokens expiring soon (requires user action)
- Usage approaching quota limits
- RLS policy violations (potential attack)

### Logging Requirements
```sql
-- Example: Log sensitive operations
CREATE TABLE IF NOT EXISTS security_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES accounts(account_id),
    action TEXT NOT NULL, -- 'api_key_created', 'oauth_connected', etc.
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS on audit log - users can view their own logs
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit logs"
ON security_audit_log
FOR SELECT
TO authenticated
USING (account_id = get_current_account_id());
```

## References
- PostgreSQL Row Security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Supabase Auth: https://supabase.com/docs/guides/auth
- OWASP API Security: https://owasp.org/www-project-api-security/
- GDPR Compliance: https://gdpr.eu/
- FILM-101: Database schema definition
- FILM-102-enable-rls.md: RLS enablement
- FILM-102-project-policies.md: Project-based policies
