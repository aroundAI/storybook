import type { RunHandle } from '@kit/generation';

import { createExternalWriter } from './external-writer';
import { createServerWriter } from './server-writer';

const serverWriter = createServerWriter();
const externalWriter = createExternalWriter();

/** The writer a run's mode picks; business code never chooses one. */
export function resolveWriter(run: RunHandle) {
  return run.mode === 'server' ? serverWriter : externalWriter;
}
