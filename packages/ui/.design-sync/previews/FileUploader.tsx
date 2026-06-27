import type { SupabaseClient } from '@supabase/supabase-js';

import { FileUploader } from '@kit/ui/file-uploader';

const mockClient = {
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
    }),
  },
} as unknown as SupabaseClient;

export function Default() {
  return (
    <div className="w-[420px]">
      <FileUploader
        client={mockClient}
        bucketName="episode-assets"
        path="season-1/episode-4/source-footage"
        maxFiles={5}
        allowedMimeTypes={['video/mp4', 'video/quicktime']}
        maxFileSize={1024 * 1024 * 500}
        onUploadSuccess={() => {}}
      />
    </div>
  );
}

export function ImagesOnly() {
  return (
    <div className="w-[420px]">
      <FileUploader
        client={mockClient}
        bucketName="character-references"
        path="mara-chen/reference-images"
        maxFiles={1}
        allowedMimeTypes={['image/png', 'image/jpeg']}
        maxFileSize={1024 * 1024 * 10}
        onUploadSuccess={() => {}}
      />
    </div>
  );
}
