import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMigrationPlan,
  dryRunMigration,
  MigrationInputError,
} from '../dist/index.js';
test('custom array prototypes are rejected without invoking payload methods or getters', () => {
  let called = 0;
  class ExecutableArray extends Array {
    toJSON() {
      called++;
      return ['INJECTED'];
    }
  }
  const inherited = [];
  Object.setPrototypeOf(
    inherited,
    Object.create(Array.prototype, {
      toJSON: {
        get() {
          called++;
          return () => ['INJECTED'];
        },
      },
    }),
  );
  for (const value of [new ExecutableArray(), inherited])
    assert.throws(
      () =>
        createMigrationPlan(true, true, [{ op: 'add', path: '/value', value }]),
      (e) => e instanceof MigrationInputError,
    );
  assert.equal(called, 0);
});

test('operation names must be strings and malformed JSON operators produce typed errors', () => {
  for (const op of [['add'], { toString: null }, { toString: [] }, null, 1])
    assert.throws(
      () => createMigrationPlan(true, true, [{ op, path: '/value', value: 1 }]),
      (e) => e instanceof MigrationInputError && e.code === 'invalid-plan',
    );
});

test('replace/remove and intermediate traversal require own JSON members, while own method names are valid data', () => {
  for (const [document, op, path] of [
    [{}, 'replace', '/toString'],
    [{}, 'remove', '/hasOwnProperty'],
    [{ nested: {} }, 'replace', '/nested/valueOf'],
    [{}, 'add', '/toString/child'],
  ]) {
    const operation = op === 'remove' ? { op, path } : { op, path, value: 1 };
    const plan = createMigrationPlan(true, true, [operation]);
    assert.throws(
      () => dryRunMigration(true, true, document, plan),
      (e) => e instanceof MigrationInputError && e.code === 'patch-failed',
    );
  }
  const own = createMigrationPlan(true, true, [
    { op: 'replace', path: '/toString', value: 2 },
    { op: 'remove', path: '/hasOwnProperty' },
  ]);
  assert.deepEqual(
    dryRunMigration(true, true, { toString: 1, hasOwnProperty: 1 }, own)
      .document,
    { toString: 2 },
  );
});

test('array add paths enforce canonical indexes, integer bounds and append semantics', () => {
  for (const path of [
    '/list/01',
    '/list/',
    '/list/4294967296',
    '/list/9007199254740992',
    '/list/3',
    '/list/length',
    '/list/-1',
    '/list/1e0',
  ]) {
    const plan = createMigrationPlan(true, true, [
      { op: 'add', path, value: 99 },
    ]);
    assert.throws(
      () => dryRunMigration(true, true, { list: [1, 2] }, plan),
      (e) => e instanceof MigrationInputError && e.code === 'patch-failed',
    );
  }
  for (const path of ['/list/2', '/list/-'])
    assert.deepEqual(
      dryRunMigration(
        true,
        true,
        { list: [1, 2] },
        createMigrationPlan(true, true, [{ op: 'add', path, value: 3 }]),
      ).document,
      { list: [1, 2, 3] },
    );
});

test('test operations use JSON equality even for own method-name members', () => {
  for (const value of [
    { hasOwnProperty: 1 },
    { nested: { hasOwnProperty: null } },
    { toString: 1, valueOf: 2 },
  ]) {
    const plan = createMigrationPlan(true, true, [
      { op: 'test', path: '', value },
    ]);
    assert.equal(dryRunMigration(true, true, value, plan).status, 'verified');
    const nested = createMigrationPlan(true, true, [
      { op: 'test', path: '/value', value },
    ]);
    assert.equal(
      dryRunMigration(true, true, { value }, nested).status,
      'verified',
    );
  }
  const ordered = createMigrationPlan(true, true, [
    { op: 'test', path: '', value: { a: 1, b: 2 } },
  ]);
  assert.equal(
    dryRunMigration(true, true, { b: 2, a: 1 }, ordered).status,
    'verified',
  );
  assert.throws(
    () => dryRunMigration(true, true, { a: 1, b: 3 }, ordered),
    (e) => e instanceof MigrationInputError && e.code === 'patch-failed',
  );
});

test('every successfully created API plan fits its own complete input/artifact bound', () => {
  const overhead = Buffer.byteLength(
    JSON.stringify([{ op: 'replace', path: '', value: '' }]),
  );
  const operations = [
    { op: 'replace', path: '', value: 'x'.repeat(1048576 - overhead) },
  ];
  assert.throws(
    () => createMigrationPlan(true, true, operations),
    (e) => e instanceof MigrationInputError && e.code === 'plan-too-large',
  );
});

test('sparse arrays cannot disguise holes with numeric named properties outside their length', () => {
  const value = [1, 2];
  delete value[0];
  value['4294967295'] = 7;
  assert.throws(
    () =>
      createMigrationPlan(true, true, [{ op: 'add', path: '/value', value }]),
    (e) => e instanceof MigrationInputError && e.code === 'invalid-input',
  );
  assert.equal(0 in value, false);
  assert.equal(value['4294967295'], 7);
});

test('complete plan depth is checked before generation succeeds', () => {
  const nested = (levels) => {
    let value = 0;
    for (let i = 0; i < levels; i++) value = { x: value };
    return value;
  };
  assert.throws(
    () =>
      createMigrationPlan(true, true, [
        { op: 'replace', path: '', value: nested(62) },
      ]),
    (e) => e instanceof MigrationInputError && e.code === 'invalid-input',
  );
  const plan = createMigrationPlan(true, true, [
    { op: 'replace', path: '', value: nested(61) },
  ]);
  assert.equal(dryRunMigration(true, true, {}, plan).status, 'verified');
});
