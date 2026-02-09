-- Migration: Create read-only viewer user
-- This user can view all data but cannot modify anything

-- Create a read-only role
CREATE ROLE readonly_viewer NOLOGIN;

-- Grant usage on schemas
GRANT USAGE ON SCHEMA public TO readonly_viewer;
GRANT USAGE ON SCHEMA auth TO readonly_viewer;

-- Grant SELECT on all existing tables in public schema
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_viewer;

-- Grant SELECT on future tables automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
GRANT SELECT ON TABLES TO readonly_viewer;

-- Create the viewer user with login credentials
CREATE USER myfriends WITH PASSWORD 'hellomyfriends98!';

-- Grant the readonly role to the user
GRANT readonly_viewer TO myfriends;

-- Add a comment for documentation
COMMENT ON ROLE myfriends IS 'Read-only viewer user for myfriends@storybook.digital - can view all data but cannot edit';
