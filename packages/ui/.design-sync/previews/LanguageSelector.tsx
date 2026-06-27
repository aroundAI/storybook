import { LanguageSelector } from '@kit/ui/language-selector';

// LanguageSelector reads `i18n.options.supportedLngs` from react-i18next's
// global instance — initialized centrally in .design-sync/preview-background.tsx
// (bundled into the shared _ds_bundle.js, the same bundle cfg.storyImports.shim
// now routes LanguageSelector's own @kit/ui import through), not here: an
// init in THIS preview's own, separately-bundled file would set up a
// different react-i18next module instance than the one LanguageSelector's
// internal useTranslation() call actually reads from.
export function Default() {
  return (
    <div className="w-[220px]">
      <LanguageSelector onChange={() => {}} />
    </div>
  );
}
