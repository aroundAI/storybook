// Manufactures react/umd/react.development.js and react-dom/umd/react-dom.development.js
// equivalents for React 19 (which ships no UMD build at all), with a real
// `process` shim — see process-global-shim.mjs (sibling) for why that's
// needed (esbuild's `inject` fixes references inside THIS build; the same
// shim's plain-JS text is also prepended raw so it defines a real global
// before _ds_bundle.js, the separately-built main bundle, evaluates).
// Output lands in a constructed node_modules dir whose other packages are
// symlinked straight from apps/web/node_modules; design-sync's
// --node-modules then points here instead, so package-build.mjs's existing
// `existsSync(reactUmd)` UMD-found branch picks these up via plain
// readFileSync — no fork of lib/emit.mjs or lib/bundle.mjs needed.
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const realNodeModules = '/Users/xuryax/Work/code/storybook/apps/web/node_modules';
// MUST live outside packages/ui — the @kit/ui symlink below points back at
// the package, so a node_modules dir nested inside it (e.g. under this same
// .design-sync/) creates infinite self-referential recursion the first
// time anything (ts-morph's tsconfig discovery) walks it.
// MUST live inside the git repo — package-build.mjs derives `workspaceRoot`
// (the bound for cfg.extraEntries/tsconfig/extraFonts path-form entries,
// incl. our own process-global-shim.mjs) from the git repo enclosing
// dirname(--node-modules); pointing outside the repo (e.g. the system tmp
// root) makes every such config path "resolve outside the workspace root".
// A repo-root scratch dir (already covered by the root .gitignore's bare
// `node_modules` rule) satisfies both constraints.
const outNodeModules = '/Users/xuryax/Work/code/storybook/.design-sync-scratch/node_modules';
const shimPath = resolve(here, 'process-shim.mjs');

rmSync(outNodeModules, { recursive: true, force: true });
mkdirSync(outNodeModules, { recursive: true });

for (const name of readdirSync(realNodeModules)) {
  if (name === 'react' || name === 'react-dom' || name === '@kit') continue;
  symlinkSync(join(realNodeModules, name), join(outNodeModules, name));
}
// @kit/ui self-imports (e.g. coming-soon.tsx imports '@kit/ui/button') would
// otherwise resolve through apps/web/node_modules/@kit/ui as a SECOND path
// to the same packages/ui files already reached directly via srcRoot —
// symlink straight to the package instead of carrying the whole @kit scope
// (which also pulls in sibling @kit/* packages with their own workspace
// cross-deps) to keep exactly one path to every file.
mkdirSync(join(outNodeModules, '@kit'), { recursive: true });
symlinkSync(resolve(here, '..'), join(outNodeModules, '@kit', 'ui'));

function vendorDir(pkgName) {
  const realPkgDir = join(realNodeModules, pkgName);
  const outPkgDir = join(outNodeModules, pkgName);
  mkdirSync(outPkgDir, { recursive: true });
  for (const name of readdirSync(realPkgDir)) {
    symlinkSync(join(realPkgDir, name), join(outPkgDir, name));
  }
  mkdirSync(join(outPkgDir, 'umd'), { recursive: true });
  return outPkgDir;
}

const reactOutDir = vendorDir('react');
const reactDomOutDir = vendorDir('react-dom');

// Single combined build (matches design-sync's own emit.mjs vendorReact
// fallback shape) so react-dom resolves the SAME React module instance —
// bundling them as two separate esbuild calls would give each its own
// copy of react, breaking hooks/context. The vendorReact() concatenation
// (react.development.js content + react-dom.development.js content) then
// just needs ONE of the two files to do the real work; the other is a
// harmless no-op so it isn't run twice.
const result = await build({
  stdin: {
    contents:
      'window.React=require("react");' +
      'window.ReactDOM=require("react-dom");' +
      'try{Object.assign(window.ReactDOM,require("react-dom/client"))}catch(e){}',
    resolveDir: realNodeModules,
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  inject: [shimPath],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});

// Also prepend a plain-JS (non-module) global process shim ahead of the
// react bundle. _vendor/react.js loads before _ds_bundle.js in every
// <Name>.html (see components/**/*.html script order) — defining
// globalThis.process here, as a real global rather than an esbuild
// `define`/`inject` (which only rewrites references INSIDE that one
// build), is also what fixes the bare `process.nextTick`/`process.platform`
// references inside the SEPARATE main bundle (lib/bundle.mjs's `define`
// only covers `process.env.NODE_ENV`, and that file can't be forked).
const globalShimText = readFileSync(resolve(here, 'process-global-shim.mjs'), 'utf8');
writeFileSync(
  join(reactOutDir, 'umd', 'react.development.js'),
  globalShimText + '\n' + result.outputFiles[0].text,
);
writeFileSync(join(reactDomOutDir, 'umd', 'react-dom.development.js'), '/* combined into react/umd/react.development.js */');

console.log(`wrote react umd stand-ins under ${outNodeModules}`);
