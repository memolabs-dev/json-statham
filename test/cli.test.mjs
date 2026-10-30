import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = (...args) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    encoding: 'utf8',
    timeout: 8000,
  });
test('CLI validates actual files with one JSON report and success exit code', () => {
  const result = cli(
    'validate',
    'examples/schema.json',
    'examples/valid.json',
    '--json',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'valid',
    diagnostics: [],
  });
});
export { cli };

test('CLI distinguishes rejected documents, potential breakage, and malformed inputs', () => {
  assert.equal(
    cli('validate', 'examples/schema.json', 'examples/invalid.json', '--json')
      .status,
    1,
  );
  assert.equal(
    cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--json',
    ).status,
    3,
  );
  const missing = cli(
    'validate',
    'does-not-exist',
    'examples/valid.json',
    '--json',
  );
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).status, 'error');
  assert.ok(!missing.stderr.includes('Error:'));
});

test('CLI bounds file size and nesting and sanitizes parse failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-'));
  try {
    const file = join(dir, 'input.json');
    for (const content of [
      '['.repeat(70) + '0' + ']'.repeat(70),
      JSON.stringify('x'.repeat(1048576)),
      '{"secret":"TOP_SECRET"',
    ]) {
      writeFileSync(file, content);
      const result = cli('validate', 'examples/schema.json', file, '--json');
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).status, 'error');
      assert.ok(!result.stdout.includes('TOP_SECRET'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI terminates pathological schema evaluation with a resource diagnostic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-slow-'));
  try {
    const schema = join(dir, 'schema.json'),
      document = join(dir, 'document.json');
    writeFileSync(
      schema,
      JSON.stringify({ type: 'string', pattern: '^(a+)+$' }),
    );
    writeFileSync(document, JSON.stringify('a'.repeat(40) + '!'));
    const result = cli('validate', schema, document, '--json');
    assert.equal(result.status, 2);
    assert.equal(
      JSON.parse(result.stdout).diagnostics[0].code,
      'resource-limit',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal help shows the portrait and documents both commands', () => {
  for (const flag of ['--help', '-h']) {
    const result = cli(flag);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /JSON STATHAM/);
    assert.match(result.stdout, /validate/);
    assert.match(result.stdout, /compare/);
    assert.match(result.stdout, /baseline/);
    assert.match(result.stdout, /Your JSON has met its match/);
    assert.equal(result.stderr, '');
  }
});

test('no arguments show portrait and usage while retaining usage exit code', () => {
  const result = cli();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /JSON STATHAM/);
  assert.match(result.stdout, /Usage:/);
});

test('portrait never contaminates machine reports or normal validation', () => {
  for (const args of [
    ['--json'],
    ['--help', '--json'],
    ['--help', 'unexpected', '--json'],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.ok(!result.stdout.includes('JSON STATHAM'));
  }
  const result = cli('validate', 'examples/schema.json', 'examples/valid.json');
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes('JSON STATHAM'));
});

test('CLI generates a baseline explicitly and reads it without changing input files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-baseline-'));
  try {
    const generated = cli(
      'baseline',
      'examples/schema.json',
      'examples/next-schema.json',
      '--json',
    );
    assert.equal(generated.status, 0, generated.stderr);
    const baseline = JSON.parse(generated.stdout);
    assert.equal(baseline.version, 1);
    const file = join(dir, 'baseline.json');
    writeFileSync(file, generated.stdout);
    const result = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      file,
      '--json',
    );
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'accepted');
    assert.equal(report.acceptedDiagnostics.length, 1);
    assert.deepEqual(report.diagnostics, []);
    const human = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      file,
    );
    assert.match(human.stdout, /Accepted baseline diagnostics: 1/);
    assert.equal(readFileSync(file, 'utf8'), generated.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale baselines keep CLI failures active and malformed files fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-stale-'));
  try {
    const baseline = join(dir, 'baseline.json'),
      changed = join(dir, 'changed.json');
    const generated = cli(
      'baseline',
      'examples/schema.json',
      'examples/next-schema.json',
    );
    assert.equal(generated.status, 0);
    writeFileSync(baseline, generated.stdout);
    const next = JSON.parse(readFileSync('examples/next-schema.json', 'utf8'));
    next.properties.name.minLength = 2;
    writeFileSync(changed, JSON.stringify(next));
    const stale = cli(
      'compare',
      'examples/schema.json',
      changed,
      '--baseline',
      baseline,
      '--json',
    );
    assert.equal(stale.status, 3);
    assert.deepEqual(JSON.parse(stale.stdout).baseline, {
      stale: true,
      accepted: 0,
    });
    assert.match(
      cli('compare', 'examples/schema.json', changed, '--baseline', baseline)
        .stdout,
      /Baseline is stale/,
    );
    for (const content of [
      'null',
      '{}',
      '{"SECRET":',
      JSON.stringify('x'.repeat(1048576)),
      '['.repeat(70) + '0' + ']'.repeat(70),
    ]) {
      writeFileSync(baseline, content);
      const result = cli(
        'compare',
        'examples/schema.json',
        changed,
        '--baseline',
        baseline,
        '--json',
      );
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).status, 'error');
      assert.ok(!result.stdout.includes('SECRET'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('baseline flags reject misuse, duplicates and missing paths', () => {
  for (const args of [
    [
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
    ],
    [
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      'x',
      '--baseline',
      'y',
    ],
    [
      'validate',
      'examples/schema.json',
      'examples/valid.json',
      '--baseline',
      'x',
    ],
    [
      'baseline',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      'x',
    ],
    [
      'baseline',
      'examples/schema.json',
      'examples/next-schema.json',
      '--json',
      '--json',
    ],
  ])
    assert.equal(cli(...args, '--json').status, 2);
});

test('baseline generation fails explicitly when its artifact cannot be loaded within the file limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-baseline-limit-'));
  try {
    const before = join(dir, 'before.json'),
      after = join(dir, 'after.json');
    writeFileSync(before, JSON.stringify({ $defs: {} }));
    writeFileSync(
      after,
      JSON.stringify({
        $defs: Object.fromEntries(
          Array.from({ length: 17000 }, (_, i) => [`d${i}`, true]),
        ),
      }),
    );
    const result = spawnSync(
      process.execPath,
      ['dist/cli.js', 'baseline', before, after, '--json'],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'error');
    assert.equal(report.diagnostics[0].code, 'baseline-too-large');
    assert.match(report.diagnostics[0].message, /1 MiB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
