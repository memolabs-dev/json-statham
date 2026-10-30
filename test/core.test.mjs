import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, compare, createBaseline } from '../dist/core.js';

test('validation accepts an admitted document and preserves it', () => {
  const document = { name: 'Statham' };
  assert.deepEqual(validate({ type: 'object', required: ['name'] }, document), {
    status: 'valid',
    diagnostics: [],
  });
  assert.deepEqual(document, { name: 'Statham' });
});

test('invalid values have pointer diagnostics without exposing payload values', () => {
  const report = validate(
    { type: 'object', properties: { token: { type: 'integer' } } },
    { token: 'TOP_SECRET' },
  );
  assert.equal(report.status, 'invalid');
  assert.equal(report.diagnostics[0].path, '/token');
  assert.equal(report.diagnostics[0].code, 'type');
  assert.ok(!JSON.stringify(report).includes('TOP_SECRET'));
});

test('contract tightening reports a schema pointer and a verified counterexample', () => {
  const before = { type: 'string' };
  const after = { type: 'string', minLength: 1 };
  const report = compare(before, after);
  assert.equal(report.status, 'potentially-breaking');
  assert.equal(report.diagnostics[0].path, '/minLength');
  assert.equal(report.counterexample, '');
  assert.equal(validate(before, report.counterexample).status, 'valid');
  assert.equal(validate(after, report.counterexample).status, 'invalid');
});

test('missing required members have escaped document pointers', () => {
  const report = validate({ type: 'object', required: ['a/b~c'] }, {});
  assert.equal(report.diagnostics[0].path, '/a~1b~0c');
  assert.equal(report.diagnostics[0].code, 'required');
});

test('two versions may keep the same contract identity', () => {
  const before = { $id: 'https://example.test/contract', type: 'string' };
  const after = {
    $id: 'https://example.test/contract',
    type: 'string',
    minLength: 1,
  };
  assert.equal(compare(before, after).status, 'potentially-breaking');
});

test('asynchronous contracts cannot silently bypass deterministic validation', () => {
  assert.throws(
    () => validate({ $async: true, type: 'integer' }, 'not an integer'),
    /Asynchronous/,
  );
  assert.throws(
    () => compare({ type: 'integer' }, { $async: true, type: 'integer' }),
    /Asynchronous/,
  );
});

test('object key order does not change a contract and nested names are escaped', () => {
  assert.equal(
    compare({ type: 'string', minLength: 1 }, { minLength: 1, type: 'string' })
      .status,
    'unchanged',
  );
  const report = compare(
    { type: 'object', properties: { 'a/b~c': { type: 'string' } } },
    { type: 'object', properties: { 'a/b~c': { type: 'integer' } } },
  );
  assert.equal(report.diagnostics[0].path, '/properties/a~1b~0c/type');
});
test('boolean contracts have real counterexamples without invented values', () => {
  const report = compare(true, false);
  assert.equal(report.status, 'potentially-breaking');
  assert.equal(report.counterexample, null);
  assert.equal(validate(false, null).status, 'invalid');
  assert.equal(compare(false, true).status, 'potentially-breaking');
});
test('local references are supported but external references and malformed schemas fail', () => {
  const schema = { $defs: { id: { type: 'integer' } }, $ref: '#/$defs/id' };
  assert.equal(validate(schema, 12).status, 'valid');
  assert.equal(validate(schema, '12').status, 'invalid');
  assert.throws(() => validate({ $ref: 'https://example.test/schema' }, {}));
  assert.throws(() => compare({ type: 12 }, { type: 12 }));
});

test('newly required members explain the caller action', () => {
  const report = compare(
    { type: 'object' },
    { type: 'object', required: ['id'] },
  );
  assert.equal(report.diagnostics[0].path, '/required');
  assert.match(report.diagnostics[0].message, /required members.*optional/i);
  assert.deepEqual(report.counterexample, {});
});

test('baseline records deterministic acceptance without storing schema contents', () => {
  const before = { type: 'string' },
    after = { type: 'string', minLength: 10, title: 'SECRET_SCHEMA_TITLE' };
  const baseline = createBaseline(before, after);
  assert.equal(baseline.version, 1);
  assert.match(baseline.comparison, /^[a-f0-9]{64}$/);
  assert.equal(baseline.accepted.length, 2);
  assert.ok(baseline.accepted.every((id) => /^[a-f0-9]{64}$/.test(id)));
  assert.deepEqual(
    createBaseline(before, {
      title: 'SECRET_SCHEMA_TITLE',
      minLength: 10,
      type: 'string',
    }),
    baseline,
  );
  assert.ok(!JSON.stringify(baseline).includes('SECRET'));
});

test('matching baseline keeps accepted findings visible without claiming unchanged contracts', () => {
  const before = { type: 'string' },
    after = { type: 'string', minLength: 1 };
  const report = compare(before, after, createBaseline(before, after));
  assert.equal(report.status, 'accepted');
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.acceptedDiagnostics[0].path, '/minLength');
  assert.deepEqual(report.baseline, { stale: false, accepted: 1 });
  assert.equal(report.counterexample, '');
});

test('stale or partial acceptance never waives a new contract', () => {
  const before = { type: 'string' },
    after = { type: 'string', minLength: 1, maxLength: 9 };
  const baseline = createBaseline(before, after);
  const partial = compare(before, after, {
    ...baseline,
    accepted: baseline.accepted.slice(0, 1),
  });
  assert.equal(partial.status, 'potentially-breaking');
  assert.equal(partial.diagnostics.length, 1);
  assert.equal(partial.acceptedDiagnostics.length, 1);
  const changed = compare(before, { ...after, minLength: 2 }, baseline);
  assert.equal(changed.status, 'potentially-breaking');
  assert.equal(changed.diagnostics.length, 2);
  assert.deepEqual(changed.baseline, { stale: true, accepted: 0 });
  assert.equal(
    compare({ type: 'number' }, after, baseline).baseline.stale,
    true,
  );
});
test('malformed baselines fail closed rather than accepting findings', () => {
  const before = { type: 'string' },
    after = { type: 'string', minLength: 1 };
  const good = createBaseline(before, after);
  for (const bad of [
    null,
    {},
    { ...good, version: 2 },
    { ...good, comparison: 'x' },
    { ...good, accepted: ['x'] },
    { ...good, accepted: [...good.accepted, ...good.accepted] },
    { ...good, extra: true },
  ]) {
    assert.throws(() => compare(before, after, bad), /Invalid baseline/);
  }
});

test('unknown baseline IDs grant no acceptance and empty baselines preserve unchanged status', () => {
  const before = { type: 'string' },
    after = { type: 'string', minLength: 1 };
  const b = createBaseline(before, after);
  assert.equal(
    compare(before, after, { ...b, accepted: ['0'.repeat(64)] }).status,
    'potentially-breaking',
  );
  assert.equal(
    compare(before, before, createBaseline(before, before)).status,
    'unchanged',
  );
  assert.throws(() => createBaseline({ type: 12 }, after));
});
