import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
