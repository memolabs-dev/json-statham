import { parentPort, workerData } from 'node:worker_threads';
import { validate, compare, createBaseline } from './core.js';
import {
  createMigrationPlan,
  dryRunMigration,
  MigrationInputError,
} from './migration.js';
import { loadJson, MAX_INPUT_BYTES } from './loader.js';
try {
  const {
    command,
    first,
    second,
    baselinePath,
    operationsPath,
    documentPath,
    planPath,
    includeResult,
  } = workerData as {
    command: string;
    first: string;
    second: string;
    baselinePath?: string;
    operationsPath?: string;
    documentPath?: string;
    planPath?: string;
    includeResult?: boolean;
  };
  const left = loadJson(first),
    right = loadJson(second);
  let report: unknown;
  switch (command) {
    case 'validate':
      report = validate(left, right);
      break;
    case 'compare':
      report = compare(
        left,
        right,
        baselinePath === undefined ? undefined : loadJson(baselinePath),
      );
      break;
    case 'baseline':
      report = createBaseline(left, right);
      break;
    case 'plan':
      report = createMigrationPlan(left, right, loadJson(operationsPath!));
      break;
    case 'dry-run': {
      const result = dryRunMigration(
        left,
        right,
        loadJson(documentPath!),
        loadJson(planPath!),
      );
      report =
        result.status === 'verified' && !includeResult
          ? {
              status: result.status,
              diagnostics: result.diagnostics,
              operationCount: result.operationCount,
              rollbackVerified: result.rollbackVerified,
            }
          : result;
      break;
    }
    default:
      throw new Error('Unsupported command.');
  }
  if (
    ['baseline', 'plan'].includes(command) &&
    Buffer.byteLength(JSON.stringify(report) + '\n', 'utf8') > MAX_INPUT_BYTES
  ) {
    report = {
      status: 'error',
      diagnostics: [
        {
          code:
            command === 'baseline' ? 'baseline-too-large' : 'plan-too-large',
          path: '',
          message:
            command === 'baseline'
              ? 'Generated baseline exceeds 1 MiB; reduce the comparison scope before accepting findings.'
              : 'Generated migration plan exceeds 1 MiB; reduce its operations.',
        },
      ],
    };
  }
  if (
    command === 'dry-run' &&
    includeResult &&
    Buffer.byteLength(JSON.stringify(report) + '\n', 'utf8') > MAX_INPUT_BYTES
  ) {
    report = {
      status: 'error',
      diagnostics: [
        {
          code: 'result-too-large',
          path: '',
          message:
            'Result and rollback export exceeds 1 MiB; reduce the migration scope.',
        },
      ],
    };
  }
  parentPort!.postMessage(report);
} catch (error) {
  parentPort!.postMessage({
    status: 'error',
    diagnostics: [
      error instanceof MigrationInputError
        ? { code: error.code, path: '', message: error.message }
        : {
            code: 'invalid-input',
            path: '',
            message:
              'Cannot read JSON inputs or compile schema; check file paths, JSON syntax, limits and supported schema keywords.',
          },
    ],
  });
}
