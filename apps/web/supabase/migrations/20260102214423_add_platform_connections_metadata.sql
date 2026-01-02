-- Add metadata column to platform_connections if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'platform_connections' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE public.platform_connections 
        ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        
        COMMENT ON COLUMN public.platform_connections.metadata IS 
            'Platform-specific metadata (e.g., channel info, avatar URL)';
    END IF;
END $$;
