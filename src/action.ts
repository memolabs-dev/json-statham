import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
try {
  const comparing = process.env.INPUT_COMMAND === 'compare';
  const first =
    (comparing ? process.env.INPUT_OLD_SCHEMA : process.env.INPUT_SCHEMA) ?? '';
  const second =
    (comparing ? process.env.INPUT_NEW_SCHEMA : process.env.INPUT_DOCUMENT) ??
    '';
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./cli.js', import.meta.url)),
      process.env.INPUT_COMMAND ?? '',
      first,
      second,
      '--json',
    ],
    { encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 },
  );
  if (result.error || result.status === null) throw new Error('Child failed');
  const report = JSON.parse(result.stdout) as {
    status: string;
    diagnostics: { path: string; message: string }[];
  };
  appendFileSync(
    process.env.GITHUB_OUTPUT!,
    `status=${report.status}\nexit-code=${result.status}\n`,
  );
  console.log(JSON.stringify(report));
  process.exitCode = result.status ?? 2;

  const escapeData = (value: string) =>
    value
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
  const escapeProperty = (value: string) =>
    escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
  for (const diagnostic of report.diagnostics.slice(0, 50)) {
    console.log(
      `::error file=${escapeProperty(second)}::${escapeData(`${diagnostic.path || '(root)'}: ${diagnostic.message}`)}`,
    );
  }

  if (report.diagnostics.length > 50)
    console.log(
      `::notice::${report.diagnostics.length - 50} additional diagnostics are available in the JSON report.`,
    );
} catch {
  try {
    appendFileSync(process.env.GITHUB_OUTPUT!, 'status=error\nexit-code=2\n');
  } catch {
    // The failure itself may be an unavailable GitHub output channel.
  }
  console.log(
    JSON.stringify({
      status: 'error',
      diagnostics: [
        {
          code: 'action-runtime',
          path: '',
          message:
            'Action execution or output failed; check inputs, output channel and resource limits.',
        },
      ],
    }),
  );
  console.log(
    '::error::Action execution or output failed; check inputs, output channel and resource limits.',
  );
  process.exitCode = 2;
}
