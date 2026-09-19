import {
  BorderedNavigationMenu,
  BorderedNavigationMenuItem,
} from '@kit/ui/bordered-navigation-menu';

// BorderedNavigationMenuItem renders its label via
// `<Trans i18nKey={label} defaults={label} />` with no children — the same
// no-instance trap documented for Trans.tsx: with no i18next instance at
// all, `getI18n()` returns undefined and the no-instance branch returns
// `children` (undefined here), ignoring `defaults` entirely, so every label
// renders blank. The instance is initialized centrally in
// .design-sync/preview-background.tsx (bundled into the shared _ds_bundle.js,
// the same bundle cfg.storyImports.shim now routes this component's own
// @kit/ui import through) — with no matching resource, i18next's default
// behavior is to return the key itself, which is exactly the label text here.
export function Default() {
  return (
    <div className="flex h-14 items-center border-b bg-background px-6">
      <BorderedNavigationMenu>
        <BorderedNavigationMenuItem
          path="/home/midnight-frequency"
          label="Overview"
          active
        />
        <BorderedNavigationMenuItem
          path="/home/midnight-frequency/studio"
          label="Studio"
        />
        <BorderedNavigationMenuItem
          path="/home/midnight-frequency/members"
          label="Members"
        />
        <BorderedNavigationMenuItem
          path="/home/midnight-frequency/billing"
          label="Billing"
        />
        <BorderedNavigationMenuItem
          path="/home/midnight-frequency/settings"
          label="Settings"
        />
      </BorderedNavigationMenu>
    </div>
  );
}
