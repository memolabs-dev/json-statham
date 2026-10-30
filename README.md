# JSON Statham

Your JSON has met its match.

Deterministic JSON Schema validation and conservative contract comparison. No AI or network access is required. Inputs are never modified.

## Install from source

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run build
npm link
```

## Validate

```sh
json-statham validate examples/schema.json examples/valid.json
json-statham validate examples/schema.json examples/invalid.json --json
```

Validation uses Ajv in strict mode with JSON Schema Draft 2020-12. Local references are supported. Unresolved external references, unknown keywords, unsupported formats and asynchronous schemas are rejected.

## Compare contracts

```sh
json-statham compare examples/schema.json examples/next-schema.json --json
```

The direction is old → new: could a previously accepted document now be rejected? Changed constraints produce schema JSON Pointers and remediation guidance. When available, `counterexample` contains a synthetic value verified against both schemas. For example, adding `minLength: 1` to a string contract produces the counterexample `""`.

Comparison is deliberately conservative: every structural change is flagged, including annotations and compatible relaxations. Identical schemas (ignoring object key order) return `unchanged`. It does not prove semantic compatibility, resolve references for comparison, or guarantee a counterexample for every finding.

## Reports and exit codes

`--json` emits a single JSON report with `status`, `diagnostics` and an optional `counterexample`. Each diagnostic has `code`, `path` (JSON Pointer) and `message`. Human reports show status and diagnostics. Diagnostics omit document values; pointers may contain property names.

| Exit | Meaning                                     |
| ---- | ------------------------------------------- |
| 0    | Valid document or unchanged schemas         |
| 1    | Document rejected by schema                 |
| 2    | Usage, JSON, schema, file or resource error |
| 3    | Potentially breaking contract change        |

## Limits and security

CLI inputs must be regular files no larger than 1 MiB, with nesting at most 64. Evaluation runs in a worker with a five-second deadline and a 128 MiB old-generation heap limit. Error reports redact underlying parser and compiler details. The reusable core (`dist/core.js`) exposes `validate` and `compare`; callers must provide their own resource isolation for untrusted inputs.

## Develop

```sh
npm run check
npm pack --dry-run
```

Checks include formatting, lint, TypeScript, unit/integration tests and real CLI tests. GitHub Actions runs these checks on Node.js 22 and 24.
