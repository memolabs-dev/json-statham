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

## Terminal portrait

Run `json-statham --help` (or `-h`) to see the original ASCII caricature inspired by Jason Statham and command help. Running without arguments shows the same screen with usage exit code 2. The monochrome portrait needs no color support or special fonts. Validation, comparison and `--json` reports keep their usual output.

```sh
node dist/cli.js --help
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

| Exit | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Valid document, unchanged schemas or accepted baseline |
| 1    | Document rejected by schema                            |
| 2    | Usage, JSON, schema, file or resource error            |
| 3    | Potentially breaking contract change                   |

## Limits and security

CLI inputs must be regular files no larger than 1 MiB, with nesting at most 64. Evaluation runs in a worker with a five-second deadline and a 128 MiB old-generation heap limit. Error reports redact underlying parser and compiler details. The synchronous library exposes `validate`, `compare` and `createBaseline` from the package root; callers must provide their own resource isolation for untrusted inputs.

## Develop

```sh
npm run check
npm pack --dry-run
```

Checks include formatting, lint, TypeScript, unit/integration tests and real CLI tests. GitHub Actions runs these checks on Node.js 22 and 24.

## GitHub Action (M1 preview)

On Linux GitHub-hosted runners, check out your repository and invoke this repository as an Action. Pin the Action to a reviewed commit SHA (no version tag is published yet). Only `contents: read` is needed; it never posts PR comments or uses a write token.

```yaml
permissions:
  contents: read
jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: memolabs-dev/json-statham@7bb0734b3e306347da37f81fb6de07eaf9bc4536
        with:
          schema: contracts/request.schema.json
          document: fixtures/request.json
```

For comparison, set `command: compare`, `old-schema` and `new-schema`. The direction is old → new. Paths refer to files in the checked-out workspace. The default command is `validate`; both its `schema`/`document` inputs (or both comparison inputs) must be provided.

The step fails for invalid documents, input/resource errors or potential breakage. Outputs `status` and `exit-code` retain CLI meanings. To inspect outputs after an expected failure, give the Action step an `id` and `continue-on-error: true`, then read `steps.<id>.outputs.status` and `steps.<id>.outputs.exit-code`; this opts out of blocking the workflow and should only be used deliberately.

The first check log line is the complete JSON report; subsequent lines are GitHub error annotations. Annotations identify the document or new-schema file and include the JSON Pointer in their message; they do not claim an exact source line. At most 50 diagnostic annotations are emitted, with a notice if more exist; the JSON report retains all findings. The Action additionally rejects CLI output above 1 MiB or a child process exceeding eight seconds. The CLI's five-second evaluation deadline still applies.

The Action sets up Node 24, installs its own locked development dependencies with lifecycle scripts disabled, and builds its CLI. This requires npm registry access during setup. Contract evaluation never resolves network references. No consumer install scripts are run. The supported library API is documented below.

## Review and accept a comparison baseline

Baselines record explicit acceptance of diagnostics; they do not prove compatibility. First review the normal comparison and its implications for callers. Generate the baseline only after deciding to accept those findings:

```sh
json-statham compare examples/schema.json examples/next-schema.json --json
json-statham baseline examples/schema.json examples/next-schema.json > accepted-baseline.json
json-statham compare examples/schema.json examples/next-schema.json --baseline accepted-baseline.json --json
```

Generation emits versioned JSON to stdout and never writes files itself. If the generated artifact would exceed the 1 MiB loading limit, generation fails with exit 2 and an explicit diagnostic. Shell redirection above explicitly creates the file; it will overwrite an existing destination, so choose it deliberately. Commit and review baseline files under your repository's usual change controls. Baselines contain SHA-256 identities, not schemas or payload values. They are not signed authorization records.

A matching baseline changes fully accepted comparisons to `status: accepted`, exit 0. Reports retain `acceptedDiagnostics`, any still-active `diagnostics`, the synthetic counterexample when available, and `baseline: {stale, accepted}`. Removing entries from the baseline's `accepted` list permits partial acceptance; remaining findings retain exit 3. Unknown IDs grant no acceptance. An accepted comparison remains a potentially breaking contract whose findings you have waived.

Any change to either schema (including annotation or array-order changes) makes the baseline stale: nothing is accepted, active findings retain exit 3, and human/JSON output identifies the stale baseline. Object-key reordering alone is ignored. Regenerate only after reviewing the new comparison. Unsupported/malformed baselines, missing files and inputs over the CLI limits return exit 2; validation does not support baselines.

For the GitHub Action, add `baseline: path/to/accepted-baseline.json` alongside `command: compare`, `old-schema` and `new-schema`. Accepted comparisons publish `status: accepted` and `exit-code: 0`, while accepted diagnostics remain visible in the JSON log report. Stale comparisons retain the usual blocking annotations.

## Library API (ESM, Node.js 22+)

Build an installable artifact from this repository with `npm ci` and `npm pack`, then install the resulting `json-statham-0.2.0.tgz` into your consumer with `npm install /path/to/json-statham-0.2.0.tgz`. Packing builds the package; importing it does not initialize the CLI or install hooks. Registry publication is a separate release action.

```ts
import {
  validate,
  compare,
  createBaseline,
  ContractInputError,
  type ValidationReport,
  type ComparisonReport,
} from 'json-statham';

try {
  const validation: ValidationReport = validate({ type: 'integer' }, 42);
  const oldSchema = { type: 'string' };
  const newSchema = { type: 'string', minLength: 1 };
  const comparison: ComparisonReport = compare(oldSchema, newSchema);
  // Only after reviewing and accepting this exact comparison:
  const baseline = createBaseline(oldSchema, newSchema);
  const accepted = compare(oldSchema, newSchema, baseline);
  console.log(validation.status, comparison.status, accepted.status);
} catch (error) {
  if (error instanceof ContractInputError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

The M1 runtime exports are `validate(schema, document)`, `compare(before, after, baseline?)`, `createBaseline(before, after)` and `ContractInputError`. Arguments are parsed JSON-compatible values; unknown inputs are checked at runtime for schema/baseline validity. No function coerces, repairs or writes user inputs. Return values are ordinary JSON-compatible report/baseline objects; there is no generic TypeScript type guard claiming a schema proves an arbitrary caller-supplied type.

| Result type        | Status values                                   | Additional fields                                                           |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `ValidationReport` | `valid`, `invalid`                              | `diagnostics`                                                               |
| `ComparisonReport` | `unchanged`, `potentially-breaking`, `accepted` | `diagnostics`, optional `counterexample`, `acceptedDiagnostics`, `baseline` |
| `Baseline`         | No status; `version: 1`                         | `comparison`, `accepted` hashes                                             |

`Report` is the validation/comparison union. `Diagnostic`, `Baseline`, `InputErrorCode` and the result types above are exported as TypeScript types. A rejected document returns `invalid`; it does not throw an input error. Expected schema/baseline failures throw `ContractInputError` with readonly `code`:

| Code                 | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `invalid-schema`     | Invalid/unsupported strict schema syntax, formats or unresolved references |
| `unsupported-schema` | Asynchronous schema execution is unsupported                               |
| `invalid-baseline`   | Malformed/unsupported baseline structure                                   |

Messages omit underlying compiler details, schema values and raw causes. Match machine codes rather than human wording. Other exceptions may represent caller programming or resource faults. The library is synchronous: it has **no worker deadline, file-size, depth or heap limits**. Use the CLI/Action or caller-owned process isolation for untrusted input. The CLI's baseline artifact size limit applies when generating/reading files; in-memory `createBaseline` does not impose that file limit. Evaluation does not resolve network references.

Only the package-root ESM imports are supported. CommonJS/browser builds and internal subpaths such as `json-statham/dist/core.js` are outside the supported API. The current 0.x compatibility policy preserves documented exports, result status sets, error codes, field meanings and baseline v1 in patch releases; intentional contract changes require a minor release (a major release after 1.0). Additive API evolution is documented in the release diff. Exact diagnostic wording and runtime performance are not stable contracts.

`npm run check` includes a real `npm pack`/temporary installation, ESM imports, strict TypeScript consumer compilation, unsupported internal-import rejection and the installed CLI binary. Dependency installation in that check needs npm cache/registry access; contract evaluation itself stays offline. Temporary consumer files are removed after the check.

## M2 preview: propose and simulate a migration

Review explicit [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) operations, then bind them to one exact source/target schema pair. This first M2 slice provides proposals, simulation and a verified in-memory rollback snapshot. Persistent file apply/restore and schema-derived operation suggestions remain future M2 slices.

```sh
json-statham plan examples/migration-old.json examples/migration-new.json --operations examples/migration-operations.json > migration-plan.json
json-statham dry-run examples/migration-old.json examples/migration-new.json --document examples/valid.json --plan migration-plan.json --json
# Explicitly export candidate document and original-value rollback snapshot:
json-statham dry-run examples/migration-old.json examples/migration-new.json --document examples/valid.json --plan migration-plan.json --json --include-result
```

`plan` emits a versioned artifact with `kind: migration`, the canonical schema-pair hash and your operations. It contains the operation values you supplied; handle it according to your data sensitivity. Shell redirection explicitly creates/overwrites the named destination. The CLI itself never edits your files. Inspect proposed operations for business intent before using their results; schema validity does not prove semantic correctness.

Supported operations are `add`, `remove`, `replace` and `test` (maximum 128). Paths use JSON Pointer escaping, including `~1` for `/` and `~0` for `~`. Paths containing `__proto__`, `constructor` or `prototype` segments are rejected; root removal and `move`/`copy` are outside this subset. Application uses [fast-json-patch](https://github.com/Starcounter-Jack/JSON-Patch) with operation validation and prototype protection, on private copies of the document and operations.

A dry-run requires a source-valid document and an exactly matching plan/schema pair. It checks the candidate against the target schema, then applies a root-replacement snapshot on a copy to verify restoration of the original JSON value and its source validity. `status: verified`, exit 0 means these checks passed, with `rollbackVerified: true` and `operationCount`; it does not apply anything persistently. Invalid source or target documents return `status: rejected`, phase `source`/`target`, sanitized diagnostics and exit 1. Bad inputs, malformed/stale plans or failed operations return exit 2.

Default reports contain no candidate/rollback values. `--json --include-result` explicitly adds `document` and `rollback`, which can contain sensitive current and original values. Exported JSON is capped at 1 MiB; a larger explicit export fails without printing a partial result. Generated plans also must fit 1 MiB including the trailing newline. File inputs and migrated documents must fit 1 MiB and depth 64. Worker time/heap limits remain in force. A result that exceeds those bounds is not reported as verified.

The source package version is 0.2.0 for these additive public exports:

```ts
import {
  createMigrationPlan,
  dryRunMigration,
  MigrationInputError,
  type MigrationPlan,
  type MigrationReport,
  type MigrationOperation,
  type MigrationErrorCode,
} from 'json-statham';

const oldSchema = { type: 'object' };
const newSchema = {
  type: 'object',
  properties: { active: { type: 'boolean' } },
  required: ['active'],
};
const plan: MigrationPlan = createMigrationPlan(oldSchema, newSchema, [
  { op: 'add', path: '/active', value: true },
]);
const result: MigrationReport = dryRunMigration(oldSchema, newSchema, {}, plan);
if (result.status === 'verified') console.log(result.document, result.rollback);
```

The pure migration API enforces JSON byte/depth and operation limits but remains synchronous; caller-owned process isolation is still needed for untrusted schemas. It rejects non-JSON values, cycles, accessors and non-plain objects instead of coercing them. Returned candidates and rollback snapshots are private copies. `MigrationInputError.code` is one of `invalid-input`, `invalid-plan`, `schema-mismatch`, `patch-failed`, `rollback-failed`, `plan-too-large`, with sanitized messages; schema compilation may throw the existing `ContractInputError`. In-memory rollback wrappers may exceed the source document byte size slightly; the CLI export cap applies to the complete emitted report. The existing GitHub Action remains validate/compare only; these new commands are available through the CLI/library.
