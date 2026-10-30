#!/usr/bin/env node
import { Worker } from 'node:worker_threads';
import type { Report } from './core.js';
import { renderHelp } from './help.js';
interface CliReport {
  status: Report['status'] | 'error';
  diagnostics: Report['diagnostics'];
}
const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = args.filter((arg) => arg !== '--json');
const [command, first, second] = positional;
function output(report: CliReport): void {
  console.log(
    json
      ? JSON.stringify(report)
      : `${report.status}\n${report.diagnostics.map((d) => `${d.path || '(root)'}: ${d.message}`).join('\n')}`,
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
  !['validate', 'compare'].includes(command) ||
  args.filter((a) => a === '--json').length > 1
) {
  output({
    status: 'error',
    diagnostics: [
      {
        code: 'usage',
        path: '',
        message:
          'Usage: json-statham <validate|compare> <schema|old> <document|new> [--json]',
      },
    ],
  });
} else {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { command, first, second },
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  });
  let finished = false;
  function finish(report: CliReport): void {
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
