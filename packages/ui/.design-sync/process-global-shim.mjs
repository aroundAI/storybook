// Several bundled deps reference bare `process.*` (nextTick, platform,
// env.NEXT_*) beyond the `process.env.NODE_ENV` checks esbuild's `define`
// replaces — see NOTES.md. Defining a real `globalThis.process` (rather
// than a textual define) fixes every such reference regardless of shape,
// and runs first since extraEntries are imported before the main entry.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
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
}
