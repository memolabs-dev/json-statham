import { Ajv2020 } from 'ajv/dist/2020.js';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}
export interface Report {
  status: 'valid' | 'invalid' | 'potentially-breaking' | 'unchanged';
  diagnostics: Diagnostic[];
}

export function validate(schema: unknown, document: unknown): Report {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    allErrors: false,
  });
  const check = ajv.compile(schema as object | boolean);
  if ('$async' in check && check.$async)
    throw new Error('Asynchronous contracts are unsupported.');
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

export interface ComparisonReport extends Report {
  counterexample?: unknown;
}
const pointer = (key: string) =>
  key.replaceAll('~', '~0').replaceAll('/', '~1');
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

export function compare(before: unknown, after: unknown): ComparisonReport {
  // Compile both contracts even when their text is identical.
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const oldCheck = ajv.compile(before as object | boolean);
  const newCheck = new Ajv2020({ strict: true, strictRequired: false }).compile(
    after as object | boolean,
  );
  if (
    ('$async' in oldCheck && oldCheck.$async) ||
    ('$async' in newCheck && newCheck.$async)
  )
    throw new Error('Asynchronous contracts are unsupported.');
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
  return report;
}
