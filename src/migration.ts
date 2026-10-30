import jsonPatch from 'fast-json-patch';
import type { Diagnostic } from './core.js';
import { validate } from './core.js';
import { digest, cloneJson, canonical } from './json.js';
import { MAX_INPUT_BYTES } from './limits.js';
export type MigrationOperation =
  | { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
  | { op: 'remove'; path: string };
export interface MigrationPlan {
  kind: 'migration';
  version: 1;
  comparison: string;
  operations: MigrationOperation[];
}
export function createMigrationPlan(
  before: unknown,
  after: unknown,
  operations: unknown,
): MigrationPlan {
  before = normalize(before);
  after = normalize(after);
  validate(before, null);
  validate(after, null);
  const proposed = normalize(operations);
  assertOperations(proposed);
  const plan: MigrationPlan = {
    kind: 'migration',
    version: 1,
    comparison: digest([before, after]),
    operations: proposed,
  };
  if (Buffer.byteLength(JSON.stringify(plan) + '\n', 'utf8') > MAX_INPUT_BYTES)
    throw new MigrationInputError('plan-too-large');
  return normalize(plan) as MigrationPlan;
}

export type MigrationErrorCode =
  | 'invalid-input'
  | 'invalid-plan'
  | 'schema-mismatch'
  | 'patch-failed'
  | 'rollback-failed'
  | 'plan-too-large';
export class MigrationInputError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode) {
    super(
      code === 'plan-too-large'
        ? 'Generated migration plan exceeds 1 MiB; reduce its operations.'
        : `Migration ${code}; review the JSON inputs, plan and schema pair.`,
    );
    this.name = 'MigrationInputError';
    this.code = code;
  }
}
function normalize(value: unknown): unknown {
  try {
    return cloneJson(value);
  } catch {
    throw new MigrationInputError('invalid-input');
  }
}
function assertOperations(
  value: unknown,
): asserts value is MigrationOperation[] {
  const fail = () => {
    throw new MigrationInputError('invalid-plan');
  };
  if (!Array.isArray(value) || value.length > 128) fail();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail();
    const op = item as Record<string, unknown>;
    if (
      typeof op.op !== 'string' ||
      !['add', 'remove', 'replace', 'test'].includes(op.op) ||
      typeof op.path !== 'string'
    )
      fail();
    const path = op.path as string;
    if (
      (path !== '' && !path.startsWith('/')) ||
      /~(?![01])/.test(path) ||
      path
        .split('/')
        .slice(1)
        .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))
        .some((s) => ['__proto__', 'constructor', 'prototype'].includes(s))
    )
      fail();
    if (op.op === 'remove' && path === '') fail();
    const expected = op.op === 'remove' ? 'op,path' : 'op,path,value';
    if (Object.keys(op).sort().join(',') !== expected) fail();
  }
}

export type MigrationReport =
  | {
      status: 'verified';
      diagnostics: Diagnostic[];
      operationCount: number;
      rollbackVerified: true;
      document: unknown;
      rollback: MigrationOperation[];
    }
  | {
      status: 'rejected';
      phase: 'source' | 'target';
      diagnostics: Diagnostic[];
      operationCount: number;
      rollbackVerified: false;
    };
export function dryRunMigration(
  before: unknown,
  after: unknown,
  document: unknown,
  inputPlan: unknown,
): MigrationReport {
  before = normalize(before);
  after = normalize(after);
  document = normalize(document);
  const plan = normalize(inputPlan);
  assertPlan(plan);
  // Compile both schemas even if source validation fails.
  validate(after, null);
  const source = validate(before, document);
  if (plan.comparison !== digest([before, after]))
    throw new MigrationInputError('schema-mismatch');
  if (source.status === 'invalid')
    return {
      status: 'rejected',
      phase: 'source',
      diagnostics: source.diagnostics,
      operationCount: plan.operations.length,
      rollbackVerified: false,
    };
  const migrated = normalize(apply(document, plan.operations));
  const target = validate(after, migrated);
  if (target.status === 'invalid')
    return {
      status: 'rejected',
      phase: 'target',
      diagnostics: target.diagnostics,
      operationCount: plan.operations.length,
      rollbackVerified: false,
    };
  const rollback: MigrationOperation[] = [
    { op: 'replace', path: '', value: normalize(document) },
  ];
  const restored = apply(migrated, rollback);
  if (
    canonical(restored) !== canonical(document) ||
    validate(before, restored).status !== 'valid'
  )
    throw new MigrationInputError('rollback-failed');
  return {
    status: 'verified',
    diagnostics: [],
    operationCount: plan.operations.length,
    rollbackVerified: true,
    document: migrated,
    rollback,
  };
}
function apply(document: unknown, operations: MigrationOperation[]): unknown {
  try {
    let current = normalize(document);
    for (const operation of structuredClone(operations)) {
      const target = ownTarget(current, operation);
      if (operation.op === 'test') {
        if (canonical(target) !== canonical(operation.value))
          throw new Error('JSON test failed.');
        continue;
      }
      current = jsonPatch.applyPatch(
        current,
        [operation] as jsonPatch.Operation[],
        true,
        true,
        true,
      ).newDocument;
    }
    return current;
  } catch {
    throw new MigrationInputError('patch-failed');
  }
}
function ownTarget(document: unknown, operation: MigrationOperation): unknown {
  if (operation.path === '') return document;
  let current = document;
  const tokens = operation.path
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i],
      last = i === tokens.length - 1;
    if (current === null || typeof current !== 'object')
      throw new Error('Missing JSON parent.');
    if (Array.isArray(current)) {
      if (token === '-' && last && operation.op === 'add') return undefined;
      const index = Number(token);
      const max =
        last && operation.op === 'add' ? current.length : current.length - 1;
      if (
        !/^(0|[1-9][0-9]*)$/.test(token) ||
        !Number.isSafeInteger(index) ||
        index > max
      )
        throw new Error('Invalid JSON array index.');
    }
    if (!Object.hasOwn(current, token)) {
      if (last && operation.op === 'add') return undefined;
      throw new Error('Missing own JSON member.');
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}
function assertPlan(value: unknown): asserts value is MigrationPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new MigrationInputError('invalid-plan');
  const plan = value as Record<string, unknown>;
  if (
    Object.keys(plan).sort().join(',') !==
      'comparison,kind,operations,version' ||
    plan.kind !== 'migration' ||
    plan.version !== 1 ||
    typeof plan.comparison !== 'string' ||
    !/^[a-f0-9]{64}$/.test(plan.comparison)
  )
    throw new MigrationInputError('invalid-plan');
  assertOperations(plan.operations);
}
