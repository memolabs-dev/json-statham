import { parentPort, workerData } from 'node:worker_threads';
import { dryRunMigration } from './migration.js';
try {
  const { before, after, document, plan } = workerData as {
    before: unknown;
    after: unknown;
    document: unknown;
    plan: unknown;
  };
  parentPort!.postMessage(dryRunMigration(before, after, document, plan));
} catch {
  parentPort!.postMessage({
    status: 'error',
    diagnostics: [
      {
        code: 'invalid-input',
        path: '',
        message: 'Transaction inputs or migration plan are invalid.',
      },
    ],
  });
}
