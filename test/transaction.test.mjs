import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  unlinkSync,
  chmodSync,
  symlinkSync,
  linkSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
const cli = (...args) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'statham-tx-'));
  const source = join(dir, 'source.json'),
    old = join(dir, 'old.json'),
    next = join(dir, 'next.json'),
    plan = join(dir, 'plan.json'),
    output = join(dir, 'migrated.json'),
    tx = join(dir, 'transaction'),
    restored = join(dir, 'restored.json');
  const bytes = '{\n  "name": "Statham", "token": "SECRET"\n}\n';
  writeFileSync(source, bytes);
  writeFileSync(old, JSON.stringify({ type: 'object' }));
  writeFileSync(
    next,
    JSON.stringify({
      type: 'object',
      properties: { active: { type: 'boolean' } },
      required: ['active'],
    }),
  );
  const ops = join(dir, 'ops.json');
  writeFileSync(
    ops,
    JSON.stringify([{ op: 'add', path: '/active', value: true }]),
  );
  const generated = cli('plan', old, next, '--operations', ops, '--json');
  assert.equal(generated.status, 0, generated.stdout);
  writeFileSync(plan, generated.stdout);
  return { dir, source, old, next, plan, output, tx, restored, bytes };
}
function stage(f) {
  return cli(
    'stage',
    f.old,
    f.next,
    '--document',
    f.source,
    '--plan',
    f.plan,
    '--transaction',
    f.tx,
    '--output',
    f.output,
    '--json',
  );
}
test('stage durably prepares private verified snapshots without publishing or changing source', () => {
  const f = fixture();
  try {
    const result = stage(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'prepared');
    assert.equal(report.rollbackVerified, true);
    assert.equal(existsSync(f.output), false);
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    assert.equal(readFileSync(join(f.tx, 'original.json'), 'utf8'), f.bytes);
    assert.equal(
      JSON.parse(readFileSync(join(f.tx, 'manifest.json'), 'utf8')).version,
      1,
    );
    assert.equal(statSync(f.tx).mode & 0o777, 0o700);
    assert.equal(statSync(join(f.tx, 'original.json')).mode & 0o777, 0o400);
    assert.ok(!result.stdout.includes('SECRET'));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
export { cli, fixture, stage };

test('apply publishes the bound new version idempotently and never changes source or existing unrelated files', () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    const args = [
      'apply',
      '--transaction',
      f.tx,
      '--document',
      f.source,
      '--output',
      f.output,
      '--json',
    ];
    const applied = cli(...args);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    assert.equal(JSON.parse(applied.stdout).status, 'applied');
    assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')), {
      name: 'Statham',
      token: 'SECRET',
      active: true,
    });
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    assert.equal(statSync(f.output).mode & 0o777, 0o600);
    const inode = statSync(f.output).ino;
    assert.equal(cli(...args).status, 0);
    assert.equal(statSync(f.output).ino, inode);
    assert.ok(!applied.stdout.includes('SECRET'));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
  const g = fixture();
  try {
    assert.equal(stage(g).status, 0);
    writeFileSync(g.output, 'DO_NOT_TOUCH');
    assert.equal(
      cli(
        'apply',
        '--transaction',
        g.tx,
        '--document',
        g.source,
        '--output',
        g.output,
        '--json',
      ).status,
      2,
    );
    assert.equal(readFileSync(g.output, 'utf8'), 'DO_NOT_TOUCH');
    assert.equal(readFileSync(g.source, 'utf8'), g.bytes);
  } finally {
    rmSync(g.dir, { recursive: true, force: true });
  }
});

test('restore publishes the original exact bytes to a new file, preserves migrated data and repeats safely', () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    assert.equal(
      cli(
        'apply',
        '--transaction',
        f.tx,
        '--document',
        f.source,
        '--output',
        f.output,
        '--json',
      ).status,
      0,
    );
    const migrated = readFileSync(f.output);
    const args = [
      'restore',
      '--transaction',
      f.tx,
      '--document',
      f.output,
      '--output',
      f.restored,
      '--json',
    ];
    const restored = cli(...args);
    assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    assert.equal(JSON.parse(restored.stdout).status, 'restored');
    assert.equal(readFileSync(f.restored, 'utf8'), f.bytes);
    assert.deepEqual(readFileSync(f.output), migrated);
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    const inode = statSync(f.restored).ino;
    assert.equal(cli(...args).status, 0);
    assert.equal(statSync(f.restored).ino, inode);
    assert.ok(!restored.stdout.includes('SECRET'));
    assert.equal(
      cli(
        'restore',
        '--transaction',
        f.tx,
        '--document',
        f.output,
        '--output',
        f.source,
        '--json',
      ).status,
      2,
    );
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('inspection is read-only and repeated commands recover real interrupted publication phases', () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    const inspect = () =>
      cli('inspect-transaction', '--transaction', f.tx, '--json');
    assert.equal(JSON.parse(inspect().stdout).status, 'prepared');
    const applyArgs = [
      'apply',
      '--transaction',
      f.tx,
      '--document',
      f.source,
      '--output',
      f.output,
      '--json',
    ];
    assert.equal(cli(...applyArgs).status, 0);
    unlinkSync(join(f.tx, 'applied.json'));
    assert.equal(JSON.parse(inspect().stdout).status, 'apply-pending');
    assert.equal(existsSync(join(f.tx, 'applied.json')), false);
    assert.equal(cli(...applyArgs).status, 0);
    assert.equal(JSON.parse(inspect().stdout).status, 'applied');
    const restoreArgs = [
      'restore',
      '--transaction',
      f.tx,
      '--document',
      f.output,
      '--output',
      f.restored,
      '--json',
    ];
    assert.equal(cli(...restoreArgs).status, 0);
    unlinkSync(join(f.tx, 'restored.json'));
    unlinkSync(f.restored);
    assert.equal(JSON.parse(inspect().stdout).status, 'restore-pending');
    assert.equal(existsSync(f.restored), false);
    assert.equal(cli(...restoreArgs).status, 0);
    assert.equal(JSON.parse(inspect().stdout).status, 'restored');
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    assert.equal(readFileSync(f.restored, 'utf8'), f.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('incomplete preparation is inspected without deleting artifacts and requires a fresh transaction directory', () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    unlinkSync(join(f.tx, 'manifest.json'));
    const result = cli('inspect-transaction', '--transaction', f.tx, '--json');
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'incomplete');
    assert.equal(readFileSync(join(f.tx, 'original.json'), 'utf8'), f.bytes);
    assert.equal(stage(f).status, 2);
    f.tx = join(f.dir, 'fresh-transaction');
    assert.equal(stage(f).status, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('source staleness, output edits and destination rebinding fail closed', () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    writeFileSync(f.source, '{"changed":true}');
    const stale = cli(
      'apply',
      '--transaction',
      f.tx,
      '--document',
      f.source,
      '--output',
      f.output,
      '--json',
    );
    assert.equal(stale.status, 2);
    assert.equal(
      JSON.parse(stale.stdout).diagnostics[0].code,
      'source-changed',
    );
    assert.equal(existsSync(f.output), false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
  const g = fixture();
  try {
    assert.equal(stage(g).status, 0);
    assert.equal(
      cli(
        'apply',
        '--transaction',
        g.tx,
        '--document',
        g.source,
        '--output',
        join(g.dir, 'other.json'),
        '--json',
      ).status,
      2,
    );
    assert.equal(existsSync(join(g.dir, 'other.json')), false);
    assert.equal(
      cli(
        'apply',
        '--transaction',
        g.tx,
        '--document',
        g.source,
        '--output',
        g.output,
        '--json',
      ).status,
      0,
    );
    writeFileSync(g.source, '{"later":true}');
    assert.equal(
      cli(
        'apply',
        '--transaction',
        g.tx,
        '--document',
        g.source,
        '--output',
        g.output,
        '--json',
      ).status,
      0,
    );
    writeFileSync(g.output, '{"USER_EDITS":true}');
    assert.equal(
      cli(
        'restore',
        '--transaction',
        g.tx,
        '--document',
        g.output,
        '--output',
        g.restored,
        '--json',
      ).status,
      2,
    );
    assert.equal(existsSync(g.restored), false);
    assert.equal(readFileSync(g.output, 'utf8'), '{"USER_EDITS":true}');
  } finally {
    rmSync(g.dir, { recursive: true, force: true });
  }
});
test('private artifacts, final symlinks, hardlink aliases and corrupted snapshots/markers are refused', () => {
  for (const mutate of [
    (f) => chmodSync(f.tx, 0o755),
    (f) => chmodSync(join(f.tx, 'original.json'), 0o644),
    (f) => {
      chmodSync(join(f.tx, 'candidate.json'), 0o600);
      writeFileSync(join(f.tx, 'candidate.json'), '{}');
      chmodSync(join(f.tx, 'candidate.json'), 0o400);
    },
    (f) => {
      unlinkSync(join(f.tx, 'original.json'));
      symlinkSync(f.source, join(f.tx, 'original.json'));
    },
    (f) =>
      linkSync(join(f.tx, 'original.json'), join(f.dir, 'outside-link.json')),
    (f) => writeFileSync(join(f.tx, 'applied.json'), '{}', { mode: 0o400 }),
  ]) {
    const f = fixture();
    try {
      assert.equal(stage(f).status, 0);
      mutate(f);
      assert.equal(
        cli(
          'apply',
          '--transaction',
          f.tx,
          '--document',
          f.source,
          '--output',
          f.output,
          '--json',
        ).status,
        2,
      );
      assert.equal(existsSync(f.output), false);
      assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
  const f = fixture();
  try {
    const link = join(f.dir, 'source-link.json');
    symlinkSync(f.source, link);
    assert.equal(
      cli(
        'stage',
        f.old,
        f.next,
        '--document',
        link,
        '--plan',
        f.plan,
        '--transaction',
        f.tx,
        '--output',
        f.output,
        '--json',
      ).status,
      2,
    );
    assert.equal(existsSync(f.tx), false);
    assert.equal(stage(f).status, 0);
    symlinkSync(f.source, f.output);
    assert.equal(
      cli(
        'apply',
        '--transaction',
        f.tx,
        '--document',
        f.source,
        '--output',
        f.output,
        '--json',
      ).status,
      2,
    );
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
function asyncCli(...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['dist/cli.js', ...args], {
      timeout: 10000,
    });
    let stdout = '';
    p.stdout.on('data', (data) => (stdout += data));
    p.once('close', (status) => resolve({ status, stdout }));
  });
}
test('concurrent applies are idempotent for one transaction and exclusive across different transactions', async () => {
  const f = fixture(),
    g = fixture();
  try {
    assert.equal(stage(f).status, 0);
    const args = [
      'apply',
      '--transaction',
      f.tx,
      '--document',
      f.source,
      '--output',
      f.output,
      '--json',
    ];
    const same = await Promise.all([asyncCli(...args), asyncCli(...args)]);
    assert.deepEqual(
      same.map((x) => x.status),
      [0, 0],
    );
    g.output = join(f.dir, 'shared.json');
    f.output = g.output;
    f.tx = join(f.dir, 'next-tx');
    assert.equal(stage(f).status, 0);
    assert.equal(stage(g).status, 0);
    const results = await Promise.all([
      asyncCli(
        'apply',
        '--transaction',
        f.tx,
        '--document',
        f.source,
        '--output',
        f.output,
        '--json',
      ),
      asyncCli(
        'apply',
        '--transaction',
        g.tx,
        '--document',
        g.source,
        '--output',
        g.output,
        '--json',
      ),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [0, 2]);
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    assert.equal(readFileSync(g.source, 'utf8'), g.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
    rmSync(g.dir, { recursive: true, force: true });
  }
});

test('stage rejects invalid UTF-8, oversized/nonregular inputs and unsafe destination parents without snapshots', () => {
  for (const bad of [
    Buffer.from([0x22, 0xff, 0x22]),
    Buffer.from('x'.repeat(1048577)),
  ]) {
    const f = fixture();
    try {
      writeFileSync(f.source, bad);
      const result = stage(f);
      assert.equal(result.status, 2);
      assert.equal(existsSync(f.tx), false);
      assert.deepEqual(readFileSync(f.source), bad);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
  const f = fixture();
  try {
    const fifo = join(f.dir, 'pipe');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const result = cli(
      'stage',
      f.old,
      f.next,
      '--document',
      fifo,
      '--plan',
      f.plan,
      '--transaction',
      f.tx,
      '--output',
      f.output,
      '--json',
    );
    assert.equal(result.status, 2);
    assert.equal(existsSync(f.tx), false);
    chmodSync(f.dir, 0o777);
    assert.equal(stage(f).status, 2);
    assert.equal(existsSync(f.tx), false);
    assert.equal(existsSync(f.output), false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('source/target invalidity and worker deadlines fail before any durable preparation', () => {
  const f = fixture();
  try {
    writeFileSync(f.source, '3');
    assert.equal(stage(f).status, 1);
    assert.equal(existsSync(f.tx), false);
    writeFileSync(f.source, f.bytes);
    const p = JSON.parse(readFileSync(f.plan, 'utf8'));
    p.operations = [];
    writeFileSync(f.plan, JSON.stringify(p));
    assert.equal(stage(f).status, 1);
    assert.equal(existsSync(f.tx), false);
    writeFileSync(
      f.old,
      JSON.stringify({ type: 'string', pattern: '^(a+)+$' }),
    );
    writeFileSync(f.next, 'true');
    writeFileSync(f.source, JSON.stringify('a'.repeat(40) + '!'));
    const ops = join(f.dir, 'slow-ops.json');
    writeFileSync(ops, '[]');
    writeFileSync(
      f.plan,
      cli('plan', f.old, f.next, '--operations', ops, '--json').stdout,
    );
    const slow = stage(f);
    assert.equal(slow.status, 2, slow.stdout);
    assert.equal(JSON.parse(slow.stdout).diagnostics[0].code, 'resource-limit');
    assert.equal(existsSync(f.tx), false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('concurrent restore attempts bind one destination and never publish the losing target', async () => {
  const f = fixture();
  try {
    assert.equal(stage(f).status, 0);
    assert.equal(
      cli(
        'apply',
        '--transaction',
        f.tx,
        '--document',
        f.source,
        '--output',
        f.output,
        '--json',
      ).status,
      0,
    );
    const second = join(f.dir, 'second-restore.json');
    const results = await Promise.all([
      asyncCli(
        'restore',
        '--transaction',
        f.tx,
        '--document',
        f.output,
        '--output',
        f.restored,
        '--json',
      ),
      asyncCli(
        'restore',
        '--transaction',
        f.tx,
        '--document',
        f.output,
        '--output',
        second,
        '--json',
      ),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [0, 2]);
    assert.equal(
      Number(existsSync(f.restored)) + Number(existsSync(second)),
      1,
    );
    const actual = existsSync(f.restored) ? f.restored : second;
    assert.equal(readFileSync(actual, 'utf8'), f.bytes);
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('tampered publication payloads never report prepared or permit an application', () => {
  for (const name of ['apply.payload', 'restore.payload']) {
    const f = fixture();
    try {
      assert.equal(stage(f).status, 0);
      writeFileSync(join(f.tx, name), 'CORRUPTED');
      assert.equal(
        cli('inspect-transaction', '--transaction', f.tx, '--json').status,
        2,
      );
      assert.equal(
        cli(
          'apply',
          '--transaction',
          f.tx,
          '--document',
          f.source,
          '--output',
          f.output,
          '--json',
        ).status,
        2,
      );
      assert.equal(existsSync(f.output), false);
      assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test('stage rejects identical transaction and output resources before creating any artifact', () => {
  const f = fixture();
  try {
    f.output = f.tx;
    const result = stage(f);
    assert.equal(result.status, 2);
    assert.equal(existsSync(f.tx), false);
    assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('restore destinations cannot enter the managed transaction namespace or poison its intent', () => {
  for (const name of [
    'restore-intent.json',
    'restored.json',
    'new-output.json',
  ]) {
    const f = fixture();
    try {
      assert.equal(stage(f).status, 0);
      assert.equal(
        cli(
          'apply',
          '--transaction',
          f.tx,
          '--document',
          f.source,
          '--output',
          f.output,
          '--json',
        ).status,
        0,
      );
      assert.equal(
        cli(
          'restore',
          '--transaction',
          f.tx,
          '--document',
          f.output,
          '--output',
          join(f.tx, name),
          '--json',
        ).status,
        2,
      );
      assert.equal(existsSync(join(f.tx, 'restore-intent.json')), false);
      assert.equal(existsSync(join(f.tx, 'restored.json')), false);
      assert.equal(
        cli(
          'restore',
          '--transaction',
          f.tx,
          '--document',
          f.output,
          '--output',
          f.restored,
          '--json',
        ).status,
        0,
      );
      assert.equal(readFileSync(f.restored, 'utf8'), f.bytes);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test('captured inputs must have trusted ancestry and cannot be writable by other users', () => {
  for (const variant of ['parent', 'file']) {
    const f = fixture();
    try {
      if (variant === 'parent') {
        const shared = join(f.dir, 'shared');
        mkdirSync(shared, { mode: 0o777 });
        chmodSync(shared, 0o777);
        f.source = join(shared, 'input.json');
        writeFileSync(f.source, f.bytes);
      } else chmodSync(f.source, 0o666);
      assert.equal(stage(f).status, 2);
      assert.equal(existsSync(f.tx), false);
      assert.equal(existsSync(f.output), false);
      assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test(
  'Darwin ACL grants cannot bypass private path mode checks',
  { skip: process.platform !== 'darwin' },
  () => {
    const f = fixture();
    try {
      const acl = `user:${userInfo().username} allow read,write,execute`;
      const result = spawnSync('/bin/chmod', ['+a', acl, f.dir], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(stage(f).status, 2);
      assert.equal(existsSync(f.tx), false);
      assert.equal(readFileSync(f.source, 'utf8'), f.bytes);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);
