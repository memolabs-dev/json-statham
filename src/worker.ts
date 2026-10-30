import { parentPort, workerData } from 'node:worker_threads';
import { validate, compare, createBaseline } from './core.js';
import { loadJson, MAX_INPUT_BYTES } from './loader.js';
try {
  const { command, first, second, baselinePath } = workerData as {
    command: string;
    first: string;
    second: string;
    baselinePath?: string;
  };
  const left = loadJson(first),
    right = loadJson(second);
  const report =
    command === 'validate'
      ? validate(left, right)
      : command === 'baseline'
        ? createBaseline(left, right)
        : compare(
            left,
            right,
            baselinePath === undefined ? undefined : loadJson(baselinePath),
          );
  if (
    command === 'baseline' &&
    Buffer.byteLength(JSON.stringify(report) + '\n', 'utf8') > MAX_INPUT_BYTES
  ) {
    parentPort!.postMessage({
      status: 'error',
      diagnostics: [
        {
          code: 'baseline-too-large',
          path: '',
          message:
            'Generated baseline exceeds 1 MiB; reduce the comparison scope before accepting findings.',
        },
      ],
    });
  } else parentPort!.postMessage(report);
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
