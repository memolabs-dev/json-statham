import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const cli = (...args) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 8 * 1048576,
  });
test('CLI exports a complete offline validation view while keeping gate exits', () => {
  const r = cli(
    'validate',
    'examples/schema.json',
    'examples/invalid.json',
    '--html',
  );
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^<!doctype html>/i);
  assert.match(r.stdout, /lang="en"/);
  assert.match(r.stdout, /Content-Security-Policy/);
  assert.match(r.stdout, /Document rejected/);
  assert.match(r.stdout, /required/);
  assert.doesNotMatch(r.stdout, /<script|<img|<link|examples\//i);
  assert.equal(r.stderr, '');
  const valid = cli(
    'validate',
    'examples/schema.json',
    'examples/valid.json',
    '--html',
  );
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /Document valid/);
  assert.match(valid.stdout, /No active diagnostics/);
});

test('HTML format is exclusive and limited to validation/comparison', () => {
  for (const args of [
    [
      'validate',
      'examples/schema.json',
      'examples/valid.json',
      '--html',
      '--html',
    ],
    [
      'validate',
      'examples/schema.json',
      'examples/valid.json',
      '--html',
      '--json',
    ],
    ['baseline', 'examples/schema.json', 'examples/next-schema.json', '--html'],
    ['inspect-transaction', '--transaction', 'absent', '--html'],
    ['--help', '--html'],
  ]) {
    const r = cli(...args);
    assert.equal(r.status, 2, args.join(' '));
    if (args.includes('--json'))
      assert.equal(JSON.parse(r.stdout).diagnostics[0].code, 'usage');
    else {
      assert.match(r.stdout, /^<!doctype html>/i);
      assert.match(r.stdout, /usage/);
    }
  }
});

test('comparison view distinguishes active, accepted and stale findings without implying compatibility', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-html-'));
  try {
    const baseline = join(dir, 'baseline.json');
    writeFileSync(
      baseline,
      cli('baseline', 'examples/schema.json', 'examples/next-schema.json')
        .stdout,
    );
    const r = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      baseline,
      '--html',
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Findings accepted/);
    assert.match(r.stdout, /Accepted diagnostics \(1\)/);
    assert.match(r.stdout, /does not prove compatibility/);
    assert.match(r.stdout, /<details>/);
    const partial = JSON.parse(readFileSync(baseline, 'utf8'));
    partial.accepted = [];
    writeFileSync(baseline, JSON.stringify(partial));
    const active = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      baseline,
      '--html',
    );
    assert.equal(active.status, 3);
    assert.match(active.stdout, /Active diagnostics \(1\)/);
    partial.comparison = '0'.repeat(64);
    writeFileSync(baseline, JSON.stringify(partial));
    const stale = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--baseline',
      baseline,
      '--html',
    );
    assert.equal(stale.status, 3);
    assert.match(stale.stdout, /Baseline is stale/);
    const unchanged = cli(
      'compare',
      'examples/schema.json',
      'examples/schema.json',
      '--html',
    );
    assert.equal(unchanged.status, 0);
    assert.match(unchanged.stdout, /Contracts unchanged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTML renders hostile property names as text and omits input values, paths and counterexamples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-html-private-'));
  try {
    const schema = join(dir, 'PRIVATE_SCHEMA.json'),
      data = join(dir, 'PRIVATE_DATA.json');
    const key =
      '</code><img src="https://invalid.example/x" onerror="alert(1)"><script>alert(2)</script>&';
    writeFileSync(schema, JSON.stringify({ type: 'object', required: [key] }));
    writeFileSync(data, JSON.stringify({ secret: 'PAYLOAD_DO_NOT_EXPORT' }));
    const original = readFileSync(data, 'utf8');
    const r = cli('validate', schema, data, '--html');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /&lt;img src=&quot;https:/);
    assert.doesNotMatch(
      r.stdout,
      /<img|<script|PAYLOAD_DO_NOT_EXPORT|PRIVATE_SCHEMA|PRIVATE_DATA/,
    );
    assert.equal(readFileSync(data, 'utf8'), original);
    const css = r.stdout.match(/<style>([\s\S]*?)<\/style>/)[1];
    const hash = createHash('sha256').update(css).digest('base64');
    assert.ok(r.stdout.includes("style-src 'sha256-" + hash + "'"));
    assert.match(r.stdout, /default-src 'none'/);
    const comparison = cli(
      'compare',
      'examples/schema.json',
      'examples/next-schema.json',
      '--html',
    );
    assert.equal(comparison.status, 3);
    assert.doesNotMatch(comparison.stdout, /&quot;name&quot;|"counterexample"/);
    writeFileSync(data, '{"token":"PARSE_SECRET"');
    const error = cli('validate', schema, data, '--html');
    assert.equal(error.status, 2);
    assert.match(error.stdout, /Check could not complete/);
    assert.doesNotMatch(error.stdout, /PARSE_SECRET/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('oversized HTML is replaced with a small complete error view before publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statham-html-large-'));
  try {
    const before = join(dir, 'old.json'),
      after = join(dir, 'new.json');
    const props = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [
        String(i) + 'x'.repeat(1400),
        { type: 'string' },
      ]),
    );
    writeFileSync(
      before,
      JSON.stringify({ type: 'object', properties: props }),
    );
    writeFileSync(
      after,
      JSON.stringify({
        type: 'object',
        properties: Object.fromEntries(
          Object.keys(props).map((k) => [k, { type: 'integer' }]),
        ),
      }),
    );
    const r = cli('compare', before, after, '--html');
    assert.equal(r.status, 2);
    assert.match(r.stdout, /report-too-large/);
    assert.ok(Buffer.byteLength(r.stdout) < 10000);
    assert.match(r.stdout, /<\/html>\s*$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
