#!/usr/bin/env node
import { Worker } from 'node:worker_threads';
import type { Report, Baseline } from './core.js';
import { renderHelp } from './help.js';
interface CliReport {
  status: Report['status'] | 'error';
  diagnostics: Report['diagnostics'];
  baseline?: { stale: boolean; accepted: number };
}
const args = process.argv.slice(2);
const json = args.includes('--json');
const positional: string[] = [];
let baselinePath: string | undefined;
let invalidOptions = false;
let seenJson = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--json') {
    if (seenJson) invalidOptions = true;
    seenJson = true;
  } else if (arg === '--baseline') {
    const next = args[++i];
    if (baselinePath !== undefined || !next || next.startsWith('--'))
      invalidOptions = true;
    else baselinePath = next;
  } else positional.push(arg);
}
const [command, first, second] = positional;
function output(report: CliReport | Baseline): void {
  if ('version' in report) {
    console.log(JSON.stringify(report));
    process.exitCode = 0;
    return;
  }

  console.log(
    json
      ? JSON.stringify(report)
      : `${report.status}\n${report.diagnostics.map((d) => `${d.path || '(root)'}: ${d.message}`).join('\n')}${report.baseline ? `\nAccepted baseline diagnostics: ${report.baseline.accepted}.${report.baseline.stale ? ' Baseline is stale; all findings remain active.' : ''}` : ''}`,
  );
  process.exitCode =
    report.status === 'error'
      ? 2
      : report.status === 'invalid'
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
} else if (
  positional.length !== 3 ||
  !['validate', 'compare', 'baseline'].includes(command) ||
  invalidOptions ||
  (baselinePath !== undefined && command !== 'compare')
) {
  output({
    status: 'error',
    diagnostics: [
      {
        code: 'usage',
        path: '',
        message:
          'Usage: json-statham <validate|compare|baseline> <schema|old> <document|new> [--json] [--baseline file (compare only)]',
      },
    ],
  });
} else {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { command, first, second, baselinePath },
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  });
  let finished = false;
  function finish(report: CliReport | Baseline): void {
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
