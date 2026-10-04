/**
 * Test-only helpers for the generation core: a recording Supabase client
 * (`./recording`), a fake run store (`./runs`) and the stage matrix's
 * fixtures and harness (`./matrix`). Not imported by product code.
 */
export * from './recording';
export {
  TEST_IDS,
  fakeRunHandle,
  fakeRunRow,
  runStoreResponder,
  runStoreState,
  toSnakeRow,
  type FakeRun,
  type FakeRunOptions,
  type RunStoreState,
} from './runs';
export * from './matrix';
