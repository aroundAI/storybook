-- Add file_size_bytes and content_type to assets table
-- These columns are required for master asset management and validation

ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
ADD COLUMN IF NOT EXISTS content_type text;

-- Add comments
COMMENT ON COLUMN public.assets.file_size_bytes IS 'Size of the file in bytes';
COMMENT ON COLUMN public.assets.content_type IS 'MIME type of the file (e.g. video/mp4, image/jpeg)';
