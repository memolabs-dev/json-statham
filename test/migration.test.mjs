import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMigrationPlan,
  MigrationInputError,
  dryRunMigration,
} from '../dist/index.js';
const before = { type: 'object', properties: { name: { type: 'string' } } };
const after = {
  type: 'object',
  properties: { name: { type: 'string' }, active: { type: 'boolean' } },
  required: ['active'],
};
test('migration proposals bind the exact schema pair and preserve explicit operations', () => {
  const operations = [{ op: 'add', path: '/active', value: true }];
  const plan = createMigrationPlan(before, after, operations);
  assert.equal(plan.kind, 'migration');
  assert.equal(plan.version, 1);
  assert.match(plan.comparison, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.operations, operations);
  operations[0].value = false;
  assert.equal(plan.operations[0].value, true);
  assert.deepEqual(
    createMigrationPlan(
      before,
      { required: ['active'], properties: after.properties, type: 'object' },
      [{ op: 'add', path: '/active', value: true }],
    ),
    plan,
  );
});

test('migration plans reject unsafe or unsupported operations and non-JSON inputs', () => {
  for (const operations of [
    null,
    {},
    [{ op: 'move', from: '/a', path: '/b' }],
    [{ op: 'add', path: '/__proto__/polluted', value: true }],
    [{ op: 'add', path: '/constructor/prototype/x', value: 1 }],
    [{ op: 'remove', path: '' }],
    [{ op: 'replace', path: '/x' }],
    [{ op: 'add', path: '/a~2b', value: 1 }],
    Array.from({ length: 129 }, () => ({ op: 'test', path: '', value: {} })),
    [{ op: 'remove', path: '/x', value: 1 }],
  ]) {
    assert.throws(
      () => createMigrationPlan(before, after, operations),
      (e) => e instanceof MigrationInputError && e.code === 'invalid-plan',
    );
  }
  for (const value of [undefined, NaN, new Date(), { x: undefined }]) {
    assert.throws(
      () => createMigrationPlan(true, true, [{ op: 'add', path: '/x', value }]),
      (e) => e instanceof MigrationInputError,
    );
  }
});

test('dry-run verifies target validity and exact rollback without changing frozen inputs', () => {
  const document = Object.freeze({ name: 'Statham' });
  const value = Object.freeze({ nested: 'x' });
  const plan = createMigrationPlan(before, after, [
    { op: 'add', path: '/active', value: true },
    { op: 'add', path: '/extra', value },
  ]);
  Object.freeze(plan.operations[0]);
  Object.freeze(plan.operations[1].value);
  Object.freeze(plan.operations[1]);
  Object.freeze(plan.operations);
  Object.freeze(plan);
  const result = dryRunMigration(before, after, document, plan);
  assert.equal(result.status, 'verified');
  assert.equal(result.rollbackVerified, true);
  assert.deepEqual(result.document, {
    name: 'Statham',
    active: true,
    extra: { nested: 'x' },
  });
  assert.deepEqual(result.rollback, [
    { op: 'replace', path: '', value: { name: 'Statham' } },
  ]);
  assert.deepEqual(document, { name: 'Statham' });
  result.rollback[0].value.name = 'changed';
  assert.equal(document.name, 'Statham');
});

test('dry-run rejects source/target violations and stale or failed plans without leaking values', () => {
  const plan = createMigrationPlan(before, after, []);
  assert.equal(
    dryRunMigration(before, after, { name: 'SECRET' }, plan).phase,
    'target',
  );
  assert.ok(
    !JSON.stringify(
      dryRunMigration(before, after, { name: 'SECRET' }, plan),
    ).includes('SECRET'),
  );
  assert.equal(
    dryRunMigration(before, after, { name: 3 }, plan).phase,
    'source',
  );
  assert.throws(
    () => dryRunMigration(before, { ...after, title: 'changed' }, {}, plan),
    (e) => e instanceof MigrationInputError && e.code === 'schema-mismatch',
  );
  for (const bad of [null, { ...plan, extra: true }, { ...plan, version: 2 }])
    assert.throws(
      () => dryRunMigration(before, after, {}, bad),
      (e) => e instanceof MigrationInputError,
    );
  const tested = createMigrationPlan(true, true, [
    { op: 'test', path: '/token', value: 'EXPECTED' },
  ]);
  assert.throws(
    () => dryRunMigration(true, true, { token: 'SECRET' }, tested),
    (e) =>
      e instanceof MigrationInputError &&
      e.code === 'patch-failed' &&
      !String(e).includes('SECRET'),
  );
});
test('root changes, escaped members and array edits verify exact rollback', () => {
  for (const [document, operations, expected] of [
    [1, [{ op: 'replace', path: '', value: [1, 2] }], [1, 2]],
    [
      { 'a/b~c': 'old' },
      [{ op: 'replace', path: '/a~1b~0c', value: 'new' }],
      { 'a/b~c': 'new' },
    ],
    [
      { list: [1, 2] },
      [
        { op: 'remove', path: '/list/0' },
        { op: 'add', path: '/list/-', value: 3 },
      ],
      { list: [2, 3] },
    ],
    [
      {},
      [
        { op: 'add', path: '/nested', value: {} },
        { op: 'add', path: '/nested/x', value: 1 },
      ],
      { nested: { x: 1 } },
    ],
  ]) {
    const plan = createMigrationPlan(true, true, operations);
    const original = JSON.stringify([document, plan]);
    const result = dryRunMigration(true, true, document, plan);
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.document, expected);
    assert.deepEqual(result.rollback[0].value, document);
    assert.equal(JSON.stringify([document, plan]), original);
  }
});
test('array indexes reject noncanonical leading zero tokens while object keys remain legal', () => {
  const plan = createMigrationPlan(true, true, [
    { op: 'replace', path: '/list/01', value: 3 },
  ]);
  assert.throws(
    () => dryRunMigration(true, true, { list: [1, 2] }, plan),
    (e) => e instanceof MigrationInputError && e.code === 'patch-failed',
  );
  const object = dryRunMigration(true, true, { list: { '01': 2 } }, plan);
  assert.deepEqual(object.document, { list: { '01': 3 } });
});

test('migration bounds reject cyclic, accessor, deep and oversized values before claiming a repair', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  let called = false;
  const accessor = {
    get secret() {
      called = true;
      return 1;
    },
  };
  for (const value of [cyclic, accessor, 'x'.repeat(1048576)])
    assert.throws(
      () => createMigrationPlan(true, true, [{ op: 'add', path: '/x', value }]),
      (e) => e instanceof MigrationInputError,
    );
  assert.equal(called, false);
  const plan = createMigrationPlan(true, true, [
    { op: 'add', path: '/b', value: 'x'.repeat(600000) },
  ]);
  assert.throws(
    () => dryRunMigration(true, true, { a: 'x'.repeat(600000) }, plan),
    (e) => e instanceof MigrationInputError && e.code === 'invalid-input',
  );
  let nested = 0;
  for (let i = 0; i < 60; i++) nested = { x: nested };
  let document = {};
  const root = document;
  for (let i = 0; i < 10; i++) {
    document.x = {};
    document = document.x;
  }
  const deepPlan = createMigrationPlan(true, true, [
    { op: 'add', path: '/x'.repeat(10) + '/value', value: nested },
  ]);
  assert.throws(
    () => dryRunMigration(true, true, root, deepPlan),
    (e) => e instanceof MigrationInputError,
  );
});

test('a document at the input byte limit can still be verified with an internal rollback snapshot', () => {
  const document = { blob: 'x'.repeat(1048576 - 11) };
  const plan = createMigrationPlan(true, true, []);
  const result = dryRunMigration(true, true, document, plan);
  assert.equal(result.status, 'verified');
  assert.equal(result.rollbackVerified, true);
  assert.deepEqual(result.rollback[0].value, document);
});
