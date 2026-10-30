#!/usr/bin/env node
import { Worker } from 'node:worker_threads';
import type { Report, Baseline } from './core.js';
import type { MigrationPlan, MigrationReport } from './migration.js';
import {
  runTransaction,
  TransactionError,
  type TransactionReport,
} from './transaction.js';
import { renderHelp } from './help.js';
interface CliReport {
  status:
    | Report['status']
    | MigrationReport['status']
    | TransactionReport['status']
    | 'error';
  diagnostics: Report['diagnostics'];
  transaction?: string;
  output?: string;
  nextAction?: string;
  baseline?: { stale: boolean; accepted: number };
  rollbackVerified?: boolean;
}
interface CommandSpec {
  positional: number;
  paths: readonly string[];
  required: readonly string[];
  persistent?: boolean;
}
const commands: Readonly<Record<string, CommandSpec>> = {
  validate: { positional: 3, paths: [], required: [] },
  compare: { positional: 3, paths: ['--baseline'], required: [] },
  baseline: { positional: 3, paths: [], required: [] },
  plan: { positional: 3, paths: ['--operations'], required: ['--operations'] },
  'dry-run': {
    positional: 3,
    paths: ['--document', '--plan'],
    required: ['--document', '--plan'],
  },
  stage: {
    positional: 3,
    paths: ['--document', '--plan', '--transaction', '--output'],
    required: ['--document', '--plan', '--transaction', '--output'],
    persistent: true,
  },
  apply: {
    positional: 1,
    paths: ['--document', '--transaction', '--output'],
    required: ['--document', '--transaction', '--output'],
    persistent: true,
  },
  restore: {
    positional: 1,
    paths: ['--document', '--transaction', '--output'],
    required: ['--document', '--transaction', '--output'],
    persistent: true,
  },
  'inspect-transaction': {
    positional: 1,
    paths: ['--transaction'],
    required: ['--transaction'],
    persistent: true,
  },
};
const valuedOptions = new Set(
  Object.values(commands).flatMap((spec) => spec.paths),
);
const args = process.argv.slice(2);
const json = args.includes('--json');
const positional: string[] = [];
const paths: Record<string, string> = {};
let includeResult = false;
let invalidOptions = false;
let seenJson = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--json') {
    if (seenJson) invalidOptions = true;
    seenJson = true;
  } else if (valuedOptions.has(arg)) {
    const next = args[++i];
    if (paths[arg] !== undefined || !next || next.startsWith('--'))
      invalidOptions = true;
    else paths[arg] = next;
  } else if (arg === '--include-result') {
    if (includeResult) invalidOptions = true;
    includeResult = true;
  } else positional.push(arg);
}
const [command, first, second] = positional;
const spec = Object.hasOwn(commands, command) ? commands[command] : undefined;
const persistent = spec?.persistent === true;
if (
  Object.keys(paths).some((key) => !spec?.paths.includes(key)) ||
  spec?.required.some((key) => !paths[key]) ||
  (includeResult && (command !== 'dry-run' || !json))
)
  invalidOptions = true;
function output(report: CliReport | Baseline | MigrationPlan): void {
  if ('version' in report) {
    console.log(JSON.stringify(report));
    process.exitCode = 0;
    return;
  }

  console.log(
    json
      ? JSON.stringify(report)
      : `${report.status}\n${report.diagnostics.map((d) => `${d.path || '(root)'}: ${d.message}`).join('\n')}${report.transaction ? `\nTransaction: ${JSON.stringify(report.transaction)}${report.output ? `\nOutput: ${JSON.stringify(report.output)}` : ''}\nNext: ${report.nextAction}` : ''}${report.rollbackVerified !== undefined ? `\nRollback verified: ${report.rollbackVerified}.` : ''}${report.baseline ? `\nAccepted baseline diagnostics: ${report.baseline.accepted}.${report.baseline.stale ? ' Baseline is stale; all findings remain active.' : ''}` : ''}`,
  );
  process.exitCode =
    report.status === 'error' || report.status === 'incomplete'
      ? 2
      : report.status === 'invalid' || report.status === 'rejected'
        ? 1
        : report.status === 'potentially-breaking'
          ? 3
          : 0;
}
if (
  args.length === 0 ||
  (args.length === 1 && ['--help', '-h'].includes(command))
) {
  console.log(renderHelp());
  process.exitCode = args.length === 0 ? 2 : 0;
} else if (!spec || positional.length !== spec.positional || invalidOptions) {
  output({
    status: 'error',
    diagnostics: [
      {
        code: 'usage',
        path: '',
        message:
          'Usage: json-statham <command> [files] [options]. Run --help for validate, compare, baseline, plan, dry-run, stage, apply, restore and inspect-transaction.',
      },
    ],
  });
} else if (persistent) {
  try {
    output(await runTransaction(command, first, second, paths));
  } catch (error) {
    output({
      status: 'error',
      diagnostics: [
        {
          code: error instanceof TransactionError ? error.code : 'io-failed',
          path: '',
          message:
            error instanceof TransactionError
              ? error.message
              : 'Transaction IO failed; no existing destination is overwritten. Inspect before retrying.',
        },
      ],
    });
  }
} else {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: {
      command,
      first,
      second,
      baselinePath: paths['--baseline'],
      operationsPath: paths['--operations'],
      documentPath: paths['--document'],
      planPath: paths['--plan'],
      includeResult,
    },
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  });
  let finished = false;
  function finish(report: CliReport | Baseline | MigrationPlan): void {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    output(report);
    void worker.terminate();
  }
  const failure = {
    status: 'error' as const,
    diagnostics: [
      {
        code: 'resource-limit',
        path: '',
        message:
          'Evaluation exceeded the 5 second or worker resource limit; simplify the schema or input.',
      },
    ],
  };
  const timer = setTimeout(() => finish(failure), 5000);
  worker.once('message', finish);
  worker.once('error', () => finish(failure));
  worker.once('exit', () => {
    if (!finished) finish(failure);
  });
}
