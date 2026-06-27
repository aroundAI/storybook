// React 19 ships no UMD build; bundling its CJS source standalone (for the
// preview vendor script) hits bare `process.*` accesses (process.emit,
// process.nextTick, process.platform) that survive esbuild's narrow
// `process.env.NODE_ENV` define. Injected as a global polyfill when building
// our own react.development.js / react-dom.development.js stand-ins.
export const process = {
  env: { NODE_ENV: 'production' },
  browser: true,
  version: '',
  versions: {},
  platform: 'browser',
  argv: [],
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  emit() {},
  on() {},
  once() {},
  off() {},
  cwd: () => '/',
};
