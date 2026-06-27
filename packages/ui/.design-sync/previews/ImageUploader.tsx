import { ImageUploader } from '@kit/ui/image-uploader';

export function Empty() {
  return (
    <ImageUploader value={null} onValueChange={() => {}}>
      <p className="text-muted-foreground text-xs">
        PNG or JPG, up to 2MB. Used as the season&apos;s default thumbnail.
      </p>
    </ImageUploader>
  );
}

export function WithImage() {
  return (
    <ImageUploader
      value="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=160&h=160&fit=crop"
      onValueChange={() => {}}
    >
      <p className="text-muted-foreground text-xs">
        PNG or JPG, up to 2MB. Used as the season&apos;s default thumbnail.
      </p>
    </ImageUploader>
  );
}
