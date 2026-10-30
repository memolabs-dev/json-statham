import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(inputs) {
  const dir = mkdtempSync(join(tmpdir(), 'statham-action-'));
  try {
    const output = join(dir, 'output');
    const result = spawnSync(process.execPath, ['dist/action.js'], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        INPUT_COMMAND: '',
        INPUT_SCHEMA: '',
        INPUT_DOCUMENT: '',
        INPUT_OLD_SCHEMA: '',
        INPUT_NEW_SCHEMA: '',
        GITHUB_OUTPUT: output,
        ...inputs,
      },
    });
    return {
      ...result,
      outputs: (() => {
        try {
          return readFileSync(output, 'utf8');
        } catch {
          return '';
        }
      })(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('Action validates real files and publishes successful gate outputs', () => {
  const result = run({
    INPUT_COMMAND: 'validate',
    INPUT_SCHEMA: 'examples/schema.json',
    INPUT_DOCUMENT: 'examples/valid.json',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, 'status=valid\nexit-code=0\n');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'valid',
    diagnostics: [],
  });
});

test('Action rejects invalid documents and annotates the document file', () => {
  const result = run({
    INPUT_COMMAND: 'validate',
    INPUT_SCHEMA: 'examples/schema.json',
    INPUT_DOCUMENT: 'examples/invalid.json',
  });
  assert.equal(result.status, 1);
  assert.equal(result.outputs, 'status=invalid\nexit-code=1\n');
  assert.match(
    result.stdout,
    /::error file=examples\/invalid.json::\/name: Document violates required/,
  );
});

test('untrusted filenames and property names cannot inject workflow commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-injection-'));
  try {
    const schema = join(dir, 'schema.json'),
      document = join(dir, 'x,y:z%\n::warning::injected.json');
    writeFileSync(
      schema,
      JSON.stringify({ type: 'object', required: ['x%\n::warning::injected'] }),
    );
    writeFileSync(document, '{}');
    const result = run({
      INPUT_COMMAND: 'validate',
      INPUT_SCHEMA: schema,
      INPUT_DOCUMENT: document,
    });
    assert.equal(result.status, 1);
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(
      lines[1].includes('x%2Cy%3Az%25%0A%3A%3Awarning%3A%3Ainjected.json::'),
    );
    assert.ok(lines[1].includes('/x%25%0A::warning::injected:'));
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Action compares contracts with the same CLI exit code and schema annotation', () => {
  const result = run({
    INPUT_COMMAND: 'compare',
    INPUT_OLD_SCHEMA: 'examples/schema.json',
    INPUT_NEW_SCHEMA: 'examples/next-schema.json',
  });
  assert.equal(result.status, 3);
  assert.equal(result.outputs, 'status=potentially-breaking\nexit-code=3\n');
  assert.match(
    result.stdout,
    /::error file=examples\/next-schema.json::\/properties\/name\/minLength:/,
  );
});

test('Action fails closed if its output channel is unavailable', () => {
  const result = run({
    INPUT_COMMAND: 'validate',
    INPUT_SCHEMA: 'examples/schema.json',
    INPUT_DOCUMENT: 'examples/valid.json',
    GITHUB_OUTPUT: '',
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout.split('\n')[0]).status, 'error');
});

test('annotation count is capped while the full JSON report remains available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-many-'));
  try {
    const oldSchema = join(dir, 'old.json'),
      newSchema = join(dir, 'new.json');
    const properties = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`field${i}`, { type: 'string' }]),
    );
    writeFileSync(oldSchema, JSON.stringify({ type: 'object', properties }));
    writeFileSync(
      newSchema,
      JSON.stringify({
        type: 'object',
        properties: Object.fromEntries(
          Object.keys(properties).map((key) => [key, { type: 'integer' }]),
        ),
      }),
    );
    const result = run({
      INPUT_COMMAND: 'compare',
      INPUT_OLD_SCHEMA: oldSchema,
      INPUT_NEW_SCHEMA: newSchema,
    });
    assert.equal(result.status, 3);
    const lines = result.stdout.trim().split('\n');
    assert.equal(JSON.parse(lines[0]).diagnostics.length, 60);
    assert.equal(
      lines.filter((line) => line.startsWith('::error ')).length,
      50,
    );
    assert.match(result.stdout, /10 additional diagnostics/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('oversized child reports fail closed and publish input-error outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-report-limit-'));
  try {
    const oldSchema = join(dir, 'old.json'),
      newSchema = join(dir, 'new.json');
    const key = 'x'.repeat(600000);
    writeFileSync(
      oldSchema,
      JSON.stringify({
        type: 'object',
        properties: { [key]: { type: 'string' } },
      }),
    );
    writeFileSync(
      newSchema,
      JSON.stringify({
        type: 'object',
        properties: { [key]: { type: 'integer' } },
      }),
    );
    const result = run({
      INPUT_COMMAND: 'compare',
      INPUT_OLD_SCHEMA: oldSchema,
      INPUT_NEW_SCHEMA: newSchema,
    });
    assert.equal(result.status, 2);
    assert.equal(result.outputs, 'status=error\nexit-code=2\n');
    assert.equal(
      JSON.parse(result.stdout.split('\n')[0]).diagnostics[0].code,
      'action-runtime',
    );
    assert.ok(result.stdout.length < 1000);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Action preserves usage and input errors without exposing parser contents', () => {
  for (const inputs of [
    { INPUT_COMMAND: 'validate' },
    { INPUT_COMMAND: 'compare' },
    {
      INPUT_COMMAND: 'validate; echo injected',
      INPUT_SCHEMA: 'examples/schema.json',
      INPUT_DOCUMENT: 'examples/valid.json',
    },
    {
      INPUT_COMMAND: 'validate',
      INPUT_SCHEMA: 'missing-schema.json',
      INPUT_DOCUMENT: 'examples/valid.json',
    },
  ]) {
    const result = run(inputs);
    assert.equal(result.status, 2);
    assert.equal(result.outputs, 'status=error\nexit-code=2\n');
    assert.equal(JSON.parse(result.stdout.split('\n')[0]).status, 'error');
    assert.equal(result.stderr, '');
  }
});
test('Action permits unchanged contracts without error annotations', () => {
  const result = run({
    INPUT_COMMAND: 'compare',
    INPUT_OLD_SCHEMA: 'examples/schema.json',
    INPUT_NEW_SCHEMA: 'examples/schema.json',
  });
  assert.equal(result.status, 0);
  assert.equal(result.outputs, 'status=unchanged\nexit-code=0\n');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'unchanged',
    diagnostics: [],
  });
});
