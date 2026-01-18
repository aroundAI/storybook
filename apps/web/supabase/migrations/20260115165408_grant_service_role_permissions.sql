-- Grant service_role access to all tables in public schema
-- This is required for Lambda functions that use the service_role key
-- to access the database (bypassing RLS for background processing)

-- Grant all privileges on all existing tables to service_role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Grant all privileges on all existing sequences to service_role
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Set default privileges for future tables created in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO service_role;

-- Also ensure service_role has USAGE on the public schema
GRANT USAGE ON SCHEMA public TO service_role;

-- Note: service_role already bypasses RLS by default in Supabase,
-- but it still needs explicit table-level grants to access the tables.
