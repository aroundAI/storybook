'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useFormContext, useWatch } from 'react-hook-form';

import {
  type Brand,
  CAPTION_BACKGROUNDS,
  CAPTION_EMPHASES,
  CAPTION_POSITIONS,
  LOGO_POSITIONS,
  TRANSITION_STYLES,
} from '@kit/desktop-integration';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import {
  ColorField,
  NumberField,
  SelectField,
  TextField,
} from '../../_components/settings-fields';
import type { ProjectAssetChoice } from '../../_lib/server/load-studio-settings-project';
import { UpdateProjectBrandSchema } from '../_lib/schemas/brand-settings.schema';
import { updateProjectBrandAction } from '../_lib/server/actions';
import { CaptionPreview } from './caption-preview';

const optionsOf = (values: readonly string[]) =>
  values.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' '),
  }));

const NONE = 'none';

const isImage = (asset: ProjectAssetChoice) =>
  asset.contentType?.startsWith('image/') ||
  (!asset.contentType &&
    ['character', 'location', 'prop', 'master_title_card'].includes(
      asset.type,
    ));

const isVideo = (asset: ProjectAssetChoice) =>
  asset.contentType?.startsWith('video/') || asset.type === 'master_video';

function AssetSelectField({
  name,
  label,
  description,
  dataTest,
  assets,
  allAssets,
}: {
  name: string;
  label: string;
  description: string;
  dataTest: string;
  assets: ProjectAssetChoice[];
  allAssets: ProjectAssetChoice[];
}) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const selected: string | null = field.value ?? null;
        // An asset set elsewhere (over MCP) stays listed even if its type
        // would not be offered here.
        const extra =
          selected && !assets.some((asset) => asset.id === selected)
            ? allAssets.filter((asset) => asset.id === selected)
            : [];

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <Select
              value={selected ?? NONE}
              onValueChange={(value) =>
                field.onChange(value === NONE ? null : value)
              }
            >
              <FormControl>
                <SelectTrigger data-test={dataTest}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={NONE} data-test={`${dataTest}-none`}>
                  None
                </SelectItem>
                {[...assets, ...extra].map((asset) => (
                  <SelectItem
                    key={asset.id}
                    value={asset.id}
                    data-test={`${dataTest}-option`}
                  >
                    {asset.name}{' '}
                    <span className="text-muted-foreground">
                      ({asset.type.replace(/_/g, ' ')})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>{description}</FormDescription>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function MusicStyleField() {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name="brand.musicStyle"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Music style</FormLabel>
          <FormControl>
            <Input
              data-test="brand-music-style"
              placeholder="lo-fi, warm, acoustic"
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              defaultValue={(field.value ?? []).join(', ')}
              onChange={(event) =>
                field.onChange(
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </FormControl>
          <FormDescription>
            Comma-separated tags the Studio matches when it picks music.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function LivePreview({ assets }: { assets: ProjectAssetChoice[] }) {
  const brand = useWatch({ name: 'brand' }) as Brand | undefined;
  const logoId = brand?.logo?.assetId ?? null;
  const logoUrl =
    assets.find((asset) => asset.id === logoId)?.previewUrl ?? null;

  return <CaptionPreview brand={brand} logoUrl={logoUrl} />;
}

export function BrandSettingsForm({
  projectId,
  brand,
  assets,
  canManage,
}: {
  projectId: string;
  brand: Brand;
  assets: ProjectAssetChoice[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(UpdateProjectBrandSchema),
    defaultValues: { projectId, brand },
  });

  const images = assets.filter(isImage);
  const videos = assets.filter(isVideo);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      try {
        await unwrap(updateProjectBrandAction(values));
        form.reset(values);
        toast.success('Brand saved');
      } catch (error) {
        toast.error(refusalMessage(error, 'The brand was not saved.'));
      }
    }),
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} data-test="brand-settings-form">
        <fieldset
          disabled={!canManage || pending}
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]"
        >
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Captions</CardTitle>
                <CardDescription>
                  How the Studio styles captions when the edit policy uses the
                  brand style.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ColorField
                  name="brand.colors.captionText"
                  label="Caption text"
                  dataTest="brand-color-caption-text"
                />
                <ColorField
                  name="brand.colors.captionBackground"
                  label="Caption background"
                  dataTest="brand-color-caption-background"
                />
                <NumberField
                  name="brand.captionStyle.fontSize"
                  label="Font size"
                  description="Pixels at 1080p, 12-200."
                  dataTest="brand-caption-font-size"
                />
                <NumberField
                  name="brand.captionStyle.maxCharsPerLine"
                  label="Characters per line"
                  description="10-80."
                  dataTest="brand-caption-max-chars"
                />
                <SelectField
                  name="brand.captionStyle.position"
                  label="Position"
                  dataTest="brand-caption-position"
                  options={optionsOf(CAPTION_POSITIONS)}
                />
                <SelectField
                  name="brand.captionStyle.background"
                  label="Background"
                  dataTest="brand-caption-background"
                  options={optionsOf(CAPTION_BACKGROUNDS)}
                />
                <SelectField
                  name="brand.captionStyle.emphasis"
                  label="Emphasis"
                  description="How emphasised words stand out."
                  dataTest="brand-caption-emphasis"
                  options={optionsOf(CAPTION_EMPHASES)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Colours and fonts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ColorField
                  name="brand.colors.primary"
                  label="Primary"
                  dataTest="brand-color-primary"
                />
                <ColorField
                  name="brand.colors.secondary"
                  label="Secondary"
                  dataTest="brand-color-secondary"
                />
                <ColorField
                  name="brand.colors.background"
                  label="Background"
                  dataTest="brand-color-background"
                />
                <div />
                <TextField
                  name="brand.fonts.heading"
                  label="Heading font"
                  dataTest="brand-font-heading"
                />
                <TextField
                  name="brand.fonts.body"
                  label="Body font"
                  description="Captions use the body font."
                  dataTest="brand-font-body"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Logo, intro and outro</CardTitle>
                <CardDescription>
                  Picked from this project&apos;s assets.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <AssetSelectField
                  name="brand.logo.assetId"
                  label="Logo"
                  description="An image asset."
                  dataTest="brand-logo-asset"
                  assets={images}
                  allAssets={assets}
                />
                <SelectField
                  name="brand.logo.position"
                  label="Logo position"
                  dataTest="brand-logo-position"
                  options={optionsOf(LOGO_POSITIONS)}
                />
                <NumberField
                  name="brand.logo.opacity"
                  label="Logo opacity"
                  description="0-1."
                  step={0.05}
                  dataTest="brand-logo-opacity"
                />
                <div />
                <AssetSelectField
                  name="brand.introAssetId"
                  label="Intro"
                  description="A video asset played before the episode."
                  dataTest="brand-intro-asset"
                  assets={videos}
                  allAssets={assets}
                />
                <AssetSelectField
                  name="brand.outroAssetId"
                  label="Outro"
                  description="A video asset played after the episode."
                  dataTest="brand-outro-asset"
                  assets={videos}
                  allAssets={assets}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Transitions and music</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="brand.transitionStyle"
                  label="Transition style"
                  dataTest="brand-transition-style"
                  options={optionsOf(TRANSITION_STYLES)}
                />
                <MusicStyleField />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle>Caption preview</CardTitle>
                <CardDescription>
                  Updates as you change the values.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LivePreview assets={assets} />
              </CardContent>
            </Card>

            <Button
              type="submit"
              className="w-full"
              data-test="brand-save"
              disabled={!canManage || pending}
            >
              {pending ? 'Saving…' : 'Save brand'}
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
