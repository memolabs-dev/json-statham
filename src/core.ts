import { canonical, digest } from './json.js';
import { Ajv2020 } from 'ajv/dist/2020.js';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}
export interface ValidationReport {
  status: 'valid' | 'invalid';
  diagnostics: Diagnostic[];
}
export type Report = ValidationReport | ComparisonReport;

export function validate(schema: unknown, document: unknown): ValidationReport {
  const check = compileSchema(schema);
  if ('$async' in check && check.$async)
    throw new ContractInputError('unsupported-schema');
  return check(document)
    ? { status: 'valid', diagnostics: [] }
    : {
        status: 'invalid',
        diagnostics: (check.errors ?? []).map((error) => ({
          code: error.keyword,
          path:
            error.instancePath +
            (error.keyword === 'required'
              ? `/${pointer(String(error.params.missingProperty))}`
              : ''),
          message: `Document violates ${error.keyword}; update the document or contract.`,
        })),
      };
}

export interface ComparisonReport {
  status: 'potentially-breaking' | 'unchanged' | 'accepted';
  diagnostics: Diagnostic[];
  counterexample?: unknown;
  acceptedDiagnostics?: Diagnostic[];
  baseline?: { stale: boolean; accepted: number };
}
const pointer = (key: string) =>
  key.replaceAll('~', '~0').replaceAll('/', '~1');

export function compare(
  before: unknown,
  after: unknown,
  baseline?: unknown,
): ComparisonReport {
  // Compile both contracts even when their text is identical.
  const oldCheck = compileSchema(before);
  const newCheck = compileSchema(after);
  if (
    ('$async' in oldCheck && oldCheck.$async) ||
    ('$async' in newCheck && newCheck.$async)
  )
    throw new ContractInputError('unsupported-schema');
  const diagnostics: Diagnostic[] = [];
  function walk(oldValue: unknown, newValue: unknown, path: string): void {
    if (canonical(oldValue) === canonical(newValue)) return;
    if (
      oldValue &&
      newValue &&
      typeof oldValue === 'object' &&
      typeof newValue === 'object' &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue)
    ) {
      const oldObject = oldValue as Record<string, unknown>;
      const newObject = newValue as Record<string, unknown>;
      for (const key of [
        ...new Set([...Object.keys(oldObject), ...Object.keys(newObject)]),
      ].sort()) {
        walk(oldObject[key], newObject[key], `${path}/${pointer(key)}`);
      }
    } else {
      diagnostics.push({
        code: 'constraint-changed',
        path,
        message: path.endsWith('/required')
          ? 'Required members changed; supply newly required members or keep them optional.'
          : `Constraint at ${path || '(root)'} changed; verify callers can satisfy the new contract.`,
      });
    }
  }
  walk(before, after, '');
  const report: ComparisonReport = {
    status: diagnostics.length ? 'potentially-breaking' : 'unchanged',
    diagnostics,
  };
  for (const candidate of [null, '', 0, 1, false, [], {}, { name: '' }]) {
    if (oldCheck(candidate) && !newCheck(candidate)) {
      report.counterexample = candidate;
      break;
    }
  }
  if (baseline !== undefined) {
    assertBaseline(baseline);
    const comparison = digest([before, after]);
    const acceptedIds = new Set(baseline.accepted);
    const accepted = report.diagnostics.filter(
      (d) =>
        baseline.comparison === comparison &&
        acceptedIds.has(diagnosticId(comparison, d)),
    );
    report.acceptedDiagnostics = accepted;
    const acceptedSet = new Set(accepted);
    report.diagnostics = report.diagnostics.filter((d) => !acceptedSet.has(d));
    report.baseline = {
      stale: baseline.comparison !== comparison,
      accepted: accepted.length,
    };
    if (accepted.length && !report.diagnostics.length)
      report.status = 'accepted';
  }
  return report;
}

export interface Baseline {
  version: 1;
  comparison: string;
  accepted: string[];
}
const diagnosticId = (comparison: string, diagnostic: Diagnostic): string =>
  digest([comparison, diagnostic.code, diagnostic.path]);
export function createBaseline(before: unknown, after: unknown): Baseline {
  const report = compare(before, after);
  const comparison = digest([before, after]);
  return {
    version: 1,
    comparison,
    accepted: report.diagnostics.map((d) => diagnosticId(comparison, d)).sort(),
  };
}

function assertBaseline(value: unknown): asserts value is Baseline {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ContractInputError('invalid-baseline');
  const b = value as Record<string, unknown>;
  const hash = (v: unknown): v is string =>
    typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (
    Object.keys(b).sort().join(',') !== 'accepted,comparison,version' ||
    b.version !== 1 ||
    !hash(b.comparison) ||
    !Array.isArray(b.accepted) ||
    !b.accepted.every(hash) ||
    new Set(b.accepted).size !== b.accepted.length
  )
    throw new ContractInputError('invalid-baseline');
}

export type InputErrorCode =
  'invalid-schema' | 'unsupported-schema' | 'invalid-baseline';
export class ContractInputError extends Error {
  readonly code: InputErrorCode;
  constructor(code: InputErrorCode) {
    const messages = {
      'invalid-schema':
        'Invalid schema; check supported JSON Schema syntax and references.',
      'unsupported-schema': 'Asynchronous contracts are unsupported.',
      'invalid-baseline': 'Invalid baseline.',
    };
    super(messages[code]);
    this.name = 'ContractInputError';
    this.code = code;
  }
}
function compileSchema(schema: unknown) {
  try {
    return new Ajv2020({
      strict: true,
      strictRequired: false,
      allErrors: false,
    }).compile(schema as object | boolean);
  } catch {
    throw new ContractInputError('invalid-schema');
  }
}
