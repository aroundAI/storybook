'use client';

import { AssetGallery } from '@kit/assets/components';

import { useAssetCreate } from './asset-create-provider';

type AssetGalleryProps = Omit<
  React.ComponentProps<typeof AssetGallery>,
  'onCreateAsset' | 'createDialog' | 'onCreateDialogClose'
>;

export function AssetLibraryGallery(props: AssetGalleryProps) {
  const { creating, openCreate, closeCreate } = useAssetCreate();

  return (
    <AssetGallery
      {...props}
      onCreateAsset={openCreate}
      createDialog={creating}
      onCreateDialogClose={closeCreate}
    />
  );
}
