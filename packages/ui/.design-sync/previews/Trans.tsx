import { Trans } from '@kit/ui/trans';

// No i18next instance exists in this isolated preview bundle, so
// react-i18next/TransWithoutContext's `getI18n()` returns undefined — its
// no-instance branch returns `children` as-is (NOT the `defaults` prop,
// which is only consulted once a real i18n instance's `t()` is available).
// Passing the real text as children (matching how a literal string would
// render even WITH a real i18n instance, since the key wouldn't resolve to
// anything else here) keeps the preview readable either way.
export function Default() {
  return (
    <p className="text-sm">
      <Trans i18nKey="common:newVersionAvailableDescription">
        A new version of the app is available. Reload to update.
      </Trans>
    </p>
  );
}

export function WithValues() {
  return (
    <p className="text-sm">
      <Trans
        i18nKey="episodes:generationComplete"
        values={{ count: 12, title: 'The Last Frequency' }}
      >
        Generated 12 shots for &ldquo;The Last Frequency&rdquo;.
      </Trans>
    </p>
  );
}
