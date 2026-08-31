import eslintConfigBase from '@kit/eslint-config/base.js';

export default [
  {
    // Design-sync tooling output: build scripts, vendored dts overrides, the
    // generated component preview library and its bundles. None of it is
    // hand-written source, so linting it only reports problems in code we do
    // not author. `.design-sync` is committed; the rest are gitignored build
    // artifacts, listed so local runs match CI.
    ignores: [
      '.design-sync/**',
      '.ds-batch-*/**',
      '.ds-sync/**',
      'ds-bundle/**',
    ],
  },
  ...eslintConfigBase,
];
