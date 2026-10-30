import { parentPort, workerData } from 'node:worker_threads';
import { validate, compare } from './core.js';
import { loadJson } from './loader.js';
try {
  const { command, first, second } = workerData as {
    command: string;
    first: string;
    second: string;
  };
  const left = loadJson(first),
    right = loadJson(second);
  parentPort!.postMessage(
    command === 'validate' ? validate(left, right) : compare(left, right),
  );
} catch {
  parentPort!.postMessage({
    status: 'error',
    diagnostics: [
      {
        code: 'invalid-input',
        path: '',
        message:
          'Cannot read JSON inputs or compile schema; check file paths, JSON syntax, limits and supported schema keywords.',
      },
    ],
  });
}
